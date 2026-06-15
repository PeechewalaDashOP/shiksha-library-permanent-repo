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
    const {
      studentData, planId, amount, fixedSeat, locker,
      startDate, endDate, photoBase64,
      isRenewal,        // boolean: true if student is renewing
      existingStudentId // string: provided by dashboard renewal flow
    } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── DUPLICATE / ACTIVE MEMBERSHIP CHECK ─────────────────────
    // If student already has an ACTIVE membership for this email, warn them.
    // We skip this check for renewals (isRenewal=true) — renewals are always allowed.
    if (!isRenewal && studentData?.email) {
      const { data: existingStudent } = await supabase
        .from("students")
        .select("id")
        .eq("email", studentData.email.toLowerCase())
        .single();

      if (existingStudent) {
        const { data: activeMemb } = await supabase
          .from("memberships")
          .select("id, end_date, plan_id")
          .eq("student_id", existingStudent.id)
          .eq("status", "active")
          .gte("end_date", new Date().toISOString().split("T")[0])
          .single();

        if (activeMemb) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: false,
              alreadyActive: true,
              message: `You already have an active membership valid until ${activeMemb.end_date}. Please renew after it expires, or use the Renew option from your dashboard.`,
              endDate: activeMemb.end_date,
            }),
          };
        }
      }
    }

    // ── AUTH USER ────────────────────────────────────────────────
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

    // ── STUDENT UPSERT ───────────────────────────────────────────
    // For renewals from dashboard, existingStudentId is provided — just fetch the student.
    // For new registrations, upsert with full details + auto-assign student_code.
    let student;
    if (isRenewal && existingStudentId) {
      // Renewal: student already exists, just fetch their record
      const { data: s, error: e } = await supabase
        .from("students")
        .select("*")
        .eq("id", existingStudentId)
        .single();
      if (e || !s) throw new Error("Could not find student record for renewal.");
      student = s;
    } else {
      // New registration: upsert full details
      // Generate student code only for brand-new students (not existing ones)
      const { data: existingCheck } = await supabase
        .from("students")
        .select("id, student_code")
        .eq("email", studentData.email.toLowerCase())
        .single();

      let studentCode = existingCheck?.student_code || null;
      if (!studentCode) {
        // Call DB function to get next code (thread-safe via DB)
        const { data: codeData } = await supabase.rpc("generate_student_code");
        studentCode = codeData || null;
      }

      const { data: s, error: e } = await supabase
        .from("students")
        .upsert({
          auth_user_id: authUserId,
          full_name: studentData.fullName,
          father_name: studentData.fatherName,
          gender: studentData.gender,
          email: studentData.email.toLowerCase(),
          phone: studentData.phone,
          aadhar: studentData.aadhar,
          address: studentData.address,
          exam_target: studentData.examTarget || "",
          student_code: studentCode,
        }, { onConflict: "email" })
        .select()
        .single();

      if (e) throw new Error("Failed to save student: " + e.message);
      student = s;
    }

    // ── PHOTO UPLOAD ─────────────────────────────────────────────
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

    // ── MEMBERSHIP ───────────────────────────────────────────────
    const registrationType = isRenewal ? "renewal" : "new";

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
        registration_type: registrationType,
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // ── PAYMENT LOG ──────────────────────────────────────────────
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
        studentCode: student.student_code,
        membershipId: membership.id,
        isNewUser: !authError,
        registrationType,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── PHOTO UPLOAD HELPER ──────────────────────────────────────────
async function uploadStudentPhoto(supabase, studentId, photoBase64) {
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
  return filePath;
}