// netlify/functions/verify-payment.js
const crypto = require("crypto");
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
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: corsHeaders, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      studentData,
      planId,
      amount,
      fixedSeat,
      locker,
      startDate: startDateInput,
      endDate: endDateInput,
      photoBase64,
      isRenewal,
      existingStudentId,
      isQueued,             // ── RENEWAL QUEUE: true when active membership exists
    } = JSON.parse(event.body);

    // 1. Verify Razorpay signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: "Payment verification failed" }) };
    }

    // 2. Supabase service role client
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
          .select("id, end_date")
          .eq("student_id", existingStudent.id)
          .eq("status", "active")
          .gte("end_date", new Date().toISOString().split("T")[0])
          .maybeSingle();

        if (activeMemb) {
          console.warn("Online payment received for student with active membership — treating as renewal.");
        }
      }
    }

    // 3. Auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: studentData.email,
      password: studentData.phone,
      email_confirm: true,
      user_metadata: { full_name: studentData.fullName },
    });

    let authUserId = null;
    if (!authError) {
      authUserId = authData.user.id;
    } else if (authError.message.includes("already registered")) {
      const { data: existingUsers } = await supabase.auth.admin.listUsers();
      const existing = existingUsers?.users?.find(u => u.email === studentData.email);
      authUserId = existing?.id || null;
    }

    // 4. Student upsert
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
          address: studentData.address || "",
          permanent_address: studentData.permanentAddress || "",
          exam_target: studentData.examTarget || "",
          student_code: studentCode,
          ...auditFields,
        }, { onConflict: "email", ignoreDuplicates: false })
        .select()
        .single();

      if (e) throw new Error("Failed to save student: " + e.message);
      student = s;
    }

    // 4b. Photo upload (non-blocking)
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
    // Online payment is already captured when this runs.
    // If isQueued: store as "queued" with NULL dates (activation calculates them).
    // Guard against duplicate queue — unique index is the final safety net.
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
        // Guard: block if queued already exists
        const { data: existingQueued } = await supabase
          .from("memberships")
          .select("id")
          .eq("student_id", student.id)
          .eq("status", "queued")
          .maybeSingle();

        if (existingQueued) {
          // Payment received but queued slot taken — flag for admin resolution
          console.error(`QUEUE DUPLICATE: Student ${student.id} already has queued membership. Payment ${razorpay_payment_id} received. Manual admin resolution required.`);
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({
              error: `A renewal is already queued for this account. Payment received (ID: ${razorpay_payment_id}) — please contact the library to resolve.`,
            }),
          };
        }

        isActuallyQueued = true;
      }
      // If no active found (expired between submit and now): treat as normal online activation
    }

    // 5. Membership dates
    // ── FEATURE 1 FIX: correct cycle rule ──
    // For queued: NULL dates (calculated at activation by activate_queued_memberships)
    // For active: calculated here (same as before)
    let startStr, endStr;
    if (isActuallyQueued) {
      startStr = null;
      endStr   = null;
    } else if (startDateInput && endDateInput) {
      startStr = startDateInput;
      endStr   = endDateInput;
    } else {
      const nowIST    = new Date(new Date().getTime() + 5.5*60*60000);
      const startDate = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
      const endDate   = new Date(startDate);
      if (planId.startsWith("monthly"))     { endDate.setMonth(endDate.getMonth() + 1); endDate.setDate(endDate.getDate() - 1); }
      else if (planId.startsWith("15days")) endDate.setDate(endDate.getDate() + 14);
      else if (planId.startsWith("3month")) { endDate.setMonth(endDate.getMonth() + 3); endDate.setDate(endDate.getDate() - 1); }
      const toIST = (d) => { const x = new Date(d.getTime() + 5.5*60*60000); return x.toISOString().split("T")[0]; };
      startStr = toIST(startDate);
      endStr   = toIST(endDate);
    }

    // 6. Membership insert
    const registrationType = isRenewal ? "renewal" : "new";

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id: student.id,
        plan_id: planId,
        fixed_seat: fixedSeat || false,
        locker: locker || false,
        amount_paid: amount,
        start_date: startStr,                               // null for queued
        end_date: endStr,                                   // null for queued
        status: isActuallyQueued ? "queued" : "active",    // queued or active
        payment_mode: "online",
        registration_type: registrationType,
        razorpay_order_id,
        razorpay_payment_id,
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // 7. Payment log
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
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        studentId: student.id,
        studentCode: student.student_code,
        membershipId: membership.id,
        endDate: endStr,
        isNewUser: !authError,
        defaultPassword: studentData.phone,
        registrationType,
        isQueued: isActuallyQueued,        // NEW: dashboard uses this to show queue message
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: err.message }) };
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