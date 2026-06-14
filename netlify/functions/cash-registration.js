// netlify/functions/cash-registration.js
const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { studentData, planId, amount, fixedSeat, locker, startDate, endDate, photoBase64 } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Create auth user
    let authUserId = null;
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: studentData.email,
      password: studentData.phone,
      email_confirm: true,
      user_metadata: { full_name: studentData.fullName },
    });

    if (!authError) {
      authUserId = authData.user.id;
    } else if (authError.message.includes("already registered")) {
      const { data: existing } = await supabase.auth.admin.listUsers();
      const found = existing?.users?.find(u => u.email === studentData.email);
      authUserId = found?.id || null;
    }

    // Upsert student
    const { data: student, error: studentError } = await supabase
      .from("students")
      .upsert({
        auth_user_id: authUserId,
        full_name: studentData.fullName,
        father_name: studentData.fatherName,
        gender: studentData.gender,
        email: studentData.email,
        phone: studentData.phone,
        aadhar: studentData.aadhar,
        address: studentData.address,
        exam_target: studentData.examTarget || "",
      }, { onConflict: "email" })
      .select()
      .single();

    if (studentError) throw new Error("Failed to save student: " + studentError.message);

    // Upload student photo to Supabase Storage (if provided), then save URL on the student row.
    // This is wrapped so a photo failure never breaks registration.
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

    // Create membership with status pending + payment_mode cash
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id: student.id,
        plan_id: planId,
        fixed_seat: fixedSeat || false,
        locker: locker || false,
        amount_paid: amount,
        start_date: startDate,
        end_date: endDate,
        status: "pending",
        payment_mode: "cash",
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // Log in payments table
    await supabase.from("payments").insert({
      student_id: student.id,
      membership_id: membership.id,
      amount,
      status: "pending",
      plan_id: planId,
      payment_mode: "cash",
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        studentId: student.id,
        membershipId: membership.id,
        isNewUser: !authError,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
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