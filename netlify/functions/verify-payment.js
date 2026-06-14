// netlify/functions/verify-payment.js
// Verifies Razorpay payment signature, saves student + membership to Supabase

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      studentData, // { fullName, fatherName, gender, email, phone, aadhar, address, examTarget }
      planId,
      amount,
      fixedSeat,
      locker,
      startDate: startDateInput,
      endDate: endDateInput,
      photoBase64,
    } = JSON.parse(event.body);

    // 1. Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Payment verification failed" }),
      };
    }

    // 2. Connect to Supabase with service role (bypasses RLS)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // 3. Create auth user account for student
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: studentData.email,
      password: studentData.phone, // Default password = phone number
      email_confirm: true,
      user_metadata: { full_name: studentData.fullName },
    });

    let authUserId = null;
    if (!authError) {
      authUserId = authData.user.id;
    } else if (authError.message.includes("already registered")) {
      // Student already exists — find their auth id
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(u => u.email === studentData.email);
      authUserId = existing?.id || null;
    }

    // 4. Upsert student record
    const { data: student, error: studentError } = await supabase
      .from("students")
      .upsert(
        {
          auth_user_id: authUserId,
          full_name: studentData.fullName,
          father_name: studentData.fatherName,
          gender: studentData.gender,
          email: studentData.email,
          phone: studentData.phone,
          aadhar: studentData.aadhar,
          address: studentData.address || "",
          exam_target: studentData.examTarget || "",
        },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (studentError) throw new Error("Failed to save student: " + studentError.message);

    // 4b. Upload student photo to Supabase Storage (if provided), then save URL on the student row.
    // Wrapped so a photo failure never breaks a verified payment's registration.
    if (photoBase64) {
      try {
        const photoUrl = await uploadStudentPhoto(supabase, student.id, photoBase64);
        if (photoUrl) {
          await supabase.from("students").update({ photo_url: photoUrl }).eq("id", student.id);
        }
      } catch (photoErr) {
        console.error("Photo upload failed (registration continued):", photoErr.message);
      }
    }

    // 5. Calculate membership dates.
    // Prefer the dates the student picked on the form; fall back to server calculation.
    let startStr, endStr;
    if (startDateInput && endDateInput) {
      startStr = startDateInput;
      endStr   = endDateInput;
    } else {
      const startDate = new Date();
      const endDate = new Date();
      if (planId.startsWith("monthly")) endDate.setMonth(endDate.getMonth() + 1);
      else if (planId.startsWith("15days")) endDate.setDate(endDate.getDate() + 15);
      else if (planId.startsWith("3month")) endDate.setMonth(endDate.getMonth() + 3);
      startStr = startDate.toISOString().split("T")[0];
      endStr   = endDate.toISOString().split("T")[0];
    }

    // 6. Create membership record
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id: student.id,
        plan_id: planId,
        fixed_seat: fixedSeat || false,
        locker: locker || false,
        amount_paid: amount,
        start_date: startStr,
        end_date: endStr,
        status: "active",
        payment_mode: "online",
        razorpay_order_id,
        razorpay_payment_id,
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // 7. Log payment
    await supabase.from("payments").insert({
      student_id: student.id,
      membership_id: membership.id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
      status: "success",
      plan_id: planId,
      payment_mode: "online",
    });

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        studentId: student.id,
        membershipId: membership.id,
        endDate: endStr,
        isNewUser: !authError,
        defaultPassword: studentData.phone,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ── Helper: upload a base64 data URL to the student-photos bucket ──
async function uploadStudentPhoto(supabase, studentId, photoBase64) {
  // photoBase64 looks like "data:image/jpeg;base64,/9j/4AAQ..."
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(photoBase64 || "");
  if (!match) return null;
  const contentType = match[1];
  const ext = contentType.split("/")[1] === "png" ? "png" : "jpg";
  const buffer = Buffer.from(match[2], "base64");
  const filePath = `${studentId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("student-photos")
    .upload(filePath, buffer, { contentType, upsert: true });

  if (uploadError) throw new Error(uploadError.message);

  // Bucket is private — store the storage path; admin can fetch via signed URL.
  return filePath;
}