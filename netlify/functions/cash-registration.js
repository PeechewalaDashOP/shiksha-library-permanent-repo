// netlify/functions/cash-registration.js
const { createClient } = require("@supabase/supabase-js");

// ── FEATURE 1: Plan ID → Student ID Prefix ──────────────────────
function getPlanPrefix(planId) {
  if (!planId) return "";
  const id = planId.toLowerCase();
  const isBasement = id.includes("basement");
  const isPrime    = id.includes("prime");
  const isGround   = !isBasement && !isPrime;
  if (isPrime) {
    if (id.includes("morning"))                             return "PM-";
    if (id.includes("evening"))                             return "PE-";
    if (id.includes("fullday") || id.includes("fullnight")) return "PF-";
  }
  if (isGround) {
    if (id.includes("morning"))   return "GM-";
    if (id.includes("evening"))   return "GE-";
    if (id.includes("fullday"))   return "GF-";
    if (id.includes("fullnight")) return "GN-";
  }
  if (isBasement) {
    if (id.includes("morning"))                             return "BM-";
    if (id.includes("evening"))                             return "BE-";
    if (id.includes("fullday") || id.includes("fullnight")) return "BF-";
  }
  return "";
}

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
      isRenewal,
      existingStudentId,
      isQueued,             // ── RENEWAL QUEUE: true when active membership exists
    } = JSON.parse(event.body);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ── DUPLICATE / ACTIVE MEMBERSHIP CHECK (new registrations) ─────────────
    if (!isRenewal && studentData?.email) {
      const { data: existingStudent } = await supabase
        .from("students")
        .select("id")
        .eq("email", studentData.email.toLowerCase())
        .maybeSingle();

      if (existingStudent) {
        const { data: activeMemb } = await supabase
          .from("memberships")
          .select("id, end_date, plan_id")
          .eq("student_id", existingStudent.id)
          .eq("status", "active")
          .gte("end_date", new Date().toISOString().split("T")[0])
          .maybeSingle();

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
    let student;
    if (isRenewal && existingStudentId) {
      const { data: s, error: e } = await supabase
        .from("students")
        .select("*")
        .eq("id", existingStudentId)
        .single();
      if (e || !s) throw new Error("Could not find student record for renewal.");
      student = s;
    } else {
      const { data: existingCheck } = await supabase
        .from("students")
        .select("id, student_code")
        .eq("email", studentData.email.toLowerCase())
        .maybeSingle();

      let studentCode = existingCheck?.student_code || null;
      if (!studentCode) {
        const { data: codeData } = await supabase.rpc("generate_student_code");
        const prefix = getPlanPrefix(planId);
        studentCode = prefix + (codeData || "");
      }

      const auditFields = {};
      if (!existingCheck?.id) {
        const nowIST = new Date(new Date().getTime() + 5.5 * 60 * 60000);
        const hh = nowIST.getUTCHours(), mm = nowIST.getUTCMinutes(), ss = nowIST.getUTCSeconds();
        const ampm = hh >= 12 ? "PM" : "AM";
        const h12 = String(hh % 12 || 12).padStart(2, "0");
        auditFields.registered_at   = nowIST.toISOString();
        auditFields.registered_date = nowIST.toISOString().split("T")[0];
        auditFields.registered_time = `${h12}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")} ${ampm} IST`;
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
          parent_mobile: studentData.parentMobile || "",
          aadhar: studentData.aadhar,
          address: studentData.address,
          permanent_address: studentData.permanentAddress || "",
          exam_target: studentData.examTarget || "",
          student_code: studentCode,
          ...auditFields,
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

    // ── RENEWAL QUEUE GUARD ──────────────────────────────────────
    // If frontend signals isQueued, verify backend and guard duplicates.
    // Status stays "pending" (cash needs admin approval regardless).
    // Dates stored as NULL — calculated at activation time by activate_queued_memberships().
    let isActuallyQueued = false;
    if (isRenewal && isQueued) {
      // Backend verify: confirm active membership still exists
      const { data: activeMemb } = await supabase
        .from("memberships")
        .select("id")
        .eq("student_id", student.id)
        .eq("status", "active")
        .maybeSingle();

      if (activeMemb) {
        // Guard: block if queued renewal already exists (any status with null dates + renewal type)
        const { data: existingQueued } = await supabase
          .from("memberships")
          .select("id, status")
          .eq("student_id", student.id)
          .eq("status", "queued")
          .maybeSingle();

        const { data: existingPendingQueue } = await supabase
          .from("memberships")
          .select("id")
          .eq("student_id", student.id)
          .eq("status", "pending")
          .eq("registration_type", "renewal")
          .is("start_date", null)
          .maybeSingle();

        if (existingQueued || existingPendingQueue) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: false,
              alreadyQueued: true,
              message: "A renewal is already pending or queued for this account. Please contact the library if you need to change it.",
            }),
          };
        }

        isActuallyQueued = true;
      }
      // If no active membership found (expired between submit and now): treat as normal renewal
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
        start_date: isActuallyQueued ? null : startDate,  // NULL = calculated at activation
        end_date:   isActuallyQueued ? null : endDate,    // NULL = calculated at activation
        status: "pending",                                  // always pending for cash
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
        isQueued: isActuallyQueued,
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