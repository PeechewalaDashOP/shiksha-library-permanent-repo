// netlify/functions/admin-direct-register.js
const { createClient } = require("@supabase/supabase-js");

// ── ADMIN EMAILS ──────────────────────────────────────────────────
// Same mechanism as admin.html — single source of truth for admin access.
// Phase 2: move to DB or env variable when supporting multiple library owners.
const ADMIN_EMAILS = ["namangalav230@gmail.com", "mahaveerrathore112@gmail.com"];

// ── PLAN PREFIX FROM PLAN ID (fixed plans) ────────────────────────
// Identical to existing cash-registration.js — do not modify.
function getPlanPrefix(planId) {
  if (!planId) return "";
  const id = planId.toLowerCase();
  const isBasement = id.includes("basement");
  const isPrime    = id.includes("prime");
  const isGround   = !isBasement && !isPrime;
  if (isPrime) {
    if (id.includes("morning"))                             return "PM";
    if (id.includes("evening"))                             return "PE";
    if (id.includes("fullday") || id.includes("fullnight")) return "PFD";
  }
  if (isGround) {
    if (id.includes("morning"))   return "GM";
    if (id.includes("evening"))   return "GE";
    if (id.includes("fullday"))   return "GFD";
    if (id.includes("fullnight")) return "GN";
  }
  if (isBasement) {
    if (id.includes("morning"))                             return "BM";
    if (id.includes("evening"))                             return "BE";
    if (id.includes("fullday") || id.includes("fullnight")) return "BFD";
  }
  return "";
}

// ── PLAN PREFIX FROM SHIFT + SECTION (custom plans) ───────────────
function getPrefixFromShiftSection(shift, section) {
  const s   = (shift   || "").toLowerCase();
  const sec = (section || "").toLowerCase();
  const isPrime    = sec.includes("prime");
  const isBasement = sec.includes("basement");
  if (isPrime) {
    if (s.includes("morning"))  return "PM";
    if (s.includes("evening"))  return "PE";
    if (s.includes("full"))     return "PFD";
  }
  if (isBasement) {
    if (s.includes("morning"))  return "BM";
    if (s.includes("evening"))  return "BE";
    if (s.includes("full"))     return "BFD";
  }
  if (s.includes("morning"))    return "GM";
  if (s.includes("evening"))    return "GE";
  if (s.includes("full night")) return "GN";
  if (s.includes("full"))       return "GFD";
  return "";
}

// ── BASE AMOUNT CALCULATOR ────────────────────────────────────────
// Isolated function so Phase 2 can replace the custom rate source without
// changing the calling code or the API contract.
//
// Phase 1: customDailyRate comes from the client (admin-entered).
//          Server recalculates — never trusts any pre-calculated total from client.
//
// Phase 2 upgrade path: add a supabase lookup inside the custom branch:
//   const { data } = await supabase.from("shift_rates")
//     .select("daily_rate").eq("shift", shift).eq("section", section).single();
//   const serverRate = data?.daily_rate ?? customDailyRate; // fallback
//   baseAmount = days * serverRate;
//   Frontend can still send customDailyRate as a "suggested" display value.
//   API contract (what frontend sends) does not need to change.
//
// Returns { baseAmount: number, source: string }
function calculateBaseAmount({ planType, planRecord, customDurationDays, customDailyRate }) {
  if (planType === "fixed") {
    // Source of truth: plan.price from DB — client-sent amount is never used here.
    return { baseAmount: planRecord.price, source: "plan_price" };
  }
  // Custom: server recalculates from raw inputs supplied by client.
  // Phase 2: replace customDailyRate with DB lookup (see comment above).
  const days = parseInt(customDurationDays);
  const rate = parseFloat(customDailyRate);
  return { baseAmount: Math.round(days * rate), source: "daily_rate_calculation" };
}

// ── END DATE CALCULATOR ───────────────────────────────────────────
// Identical logic to verify-payment.js and cash-registration.js.
function calculateEndDate(startDateStr, planId, customDurationDays) {
  const [y, m, d] = startDateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d);
  if (customDurationDays > 0) {
    end.setDate(end.getDate() + (customDurationDays - 1)); // same as 15days (+14)
  } else if (planId) {
    if      (planId.startsWith("monthly"))  { end.setMonth(end.getMonth() + 1); end.setDate(end.getDate() - 1); }
    else if (planId.startsWith("15days"))     end.setDate(end.getDate() + 14);
    else if (planId.startsWith("3month"))   { end.setMonth(end.getMonth() + 3); end.setDate(end.getDate() - 1); }
  }
  return [
    end.getFullYear(),
    String(end.getMonth() + 1).padStart(2, "0"),
    String(end.getDate()).padStart(2, "0"),
  ].join("-");
}

// ── STUDENT FIELD VALIDATOR ───────────────────────────────────────
// Validates all mandatory fields required by the existing registration flow.
// Matches: fullName, fatherName, gender, email, phone, aadhar, address, examTarget.
function validateStudentData(data) {
  if (!data?.fullName?.trim())                                      return "fullName is required.";
  if (!data?.fatherName?.trim())                                    return "fatherName is required.";
  if (!["Male", "Female"].includes(data?.gender))                   return "gender must be Male or Female.";
  if (!data?.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return "Valid email is required.";
  if (!/^[6-9][0-9]{9}$/.test(data?.phone?.trim()))                return "phone must be a valid 10-digit mobile number.";
  if (!/^[0-9]{12}$/.test(data?.aadhar?.trim()))                   return "aadhar must be exactly 12 digits.";
  if (!data?.address?.trim())                                       return "address is required.";
  if (!data?.examTarget?.trim())                                    return "examTarget is required.";
  return null;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type":                 "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {

    // ── 1. ADMIN AUTH CHECK ───────────────────────────────────────
    // Email-based — same mechanism as admin.html ADMIN_EMAILS check.
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    const token    = authHeader.replace("Bearer ", "");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid or expired session" }) };
    }
    if (!ADMIN_EMAILS.includes(user.email)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
    }

    // ── 2. PARSE BODY ─────────────────────────────────────────────
    const {
      existingStudentId,
      studentData,
      photoBase64,

      planType,
      planId,
      customDurationDays,
      customDailyRate,        // raw rate from frontend — server recalculates base from this
      shift,
      section,

      amountPaid,             // final negotiated amount — stored as amount_paid
      discountReason,

      fixedSeat,
      locker,
      startDate,
      paymentMode,
    } = JSON.parse(event.body);

    // ── 3. INPUT VALIDATION ───────────────────────────────────────
    if (!planType || !["fixed", "custom"].includes(planType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "planType must be 'fixed' or 'custom'" }) };
    }
    if (planType === "fixed" && !planId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "planId is required for fixed plans" }) };
    }
    if (planType === "custom") {
      const days = parseInt(customDurationDays);
      if (!days || days < 1 || days > 365) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "customDurationDays must be 1–365" }) };
      }
      if (!shift || !section) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "shift and section are required for custom plans" }) };
      }
      const rate = parseFloat(customDailyRate);
      if (!rate || rate <= 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "customDailyRate must be a positive number" }) };
      }
    }
    if (amountPaid === undefined || amountPaid === null || Number(amountPaid) < 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid amountPaid is required" }) };
    }
    if (Number(amountPaid) === 0 && paymentMode !== "complimentary") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Zero amount is only valid for complimentary registrations" }) };
    }
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "startDate must be YYYY-MM-DD" }) };
    }
    if (!existingStudentId && !studentData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "existingStudentId or studentData is required" }) };
    }

    // Start date ±7 days from today IST
    const nowIST     = new Date(new Date().getTime() + 5.5 * 60 * 60000);
    const todayStr   = nowIST.toISOString().split("T")[0];
    const minDate    = new Date(nowIST); minDate.setDate(minDate.getDate() - 7);
    const maxDate    = new Date(nowIST); maxDate.setDate(maxDate.getDate() + 7);
    const startObj   = new Date(startDate);
    if (startObj < minDate || startObj > maxDate) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "startDate must be within 7 days of today" }) };
    }

    // ── 4. FETCH PLAN (fixed only) ────────────────────────────────
    let planRecord = null;
    if (planType === "fixed") {
      const { data: p, error: pErr } = await supabase
        .from("plans")
        .select("id, name, price, duration, shift, section, is_active")
        .eq("id", planId)
        .single();
      if (pErr || !p)   return { statusCode: 400, headers, body: JSON.stringify({ error: "Plan not found" }) };
      if (!p.is_active) return { statusCode: 400, headers, body: JSON.stringify({ error: "Selected plan is inactive" }) };
      planRecord = p;
    }

    // ── 5. SERVER-SIDE BASE AMOUNT CALCULATION & VALIDATION ───────
    // Server recalculates base independently — never trusts any pre-computed
    // total from the client. Only raw inputs (planId→DB price, or days×rate) are trusted.
    const { baseAmount } = calculateBaseAmount({
      planType,
      planRecord,
      customDurationDays,
      customDailyRate,
    });
    const finalAmount = Number(amountPaid);

    if (finalAmount < baseAmount && !discountReason?.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: `Amount ₹${finalAmount} is below the standard ₹${baseAmount}. discountReason is required.`,
        }),
      };
    }
    if (paymentMode === "complimentary" && !discountReason?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "discountReason is required for complimentary registrations" }) };
    }

    // ── 6. STUDENT ────────────────────────────────────────────────
    let student;

    if (existingStudentId) {
      const { data: s, error: e } = await supabase
        .from("students").select("*").eq("id", existingStudentId).single();
      if (e || !s) return { statusCode: 400, headers, body: JSON.stringify({ error: "Student not found" }) };
      student = s;

    } else {
      // Validate all mandatory fields — same as existing registration flow
      const fieldError = validateStudentData(studentData);
      if (fieldError) return { statusCode: 400, headers, body: JSON.stringify({ error: fieldError }) };

      // Auth user (non-blocking on already-registered)
      let authUserId = null;
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email:         studentData.email.toLowerCase(),
        password:      studentData.phone,
        email_confirm: true,
        user_metadata: { full_name: studentData.fullName },
      });
      if (!authError) {
        authUserId = authData.user.id;
      } else if (authError.message.includes("already registered")) {
        const { data: existing } = await supabase.auth.admin.listUsers();
        const found = existing?.users?.find(u => u.email === studentData.email.toLowerCase());
        authUserId = found?.id || null;
      }

      // Student code
      const { data: existingCheck } = await supabase
        .from("students").select("id, student_code")
        .eq("email", studentData.email.toLowerCase()).maybeSingle();

      let studentCode = existingCheck?.student_code || null;
      if (!studentCode) {
        const { data: codeData } = await supabase.rpc("generate_student_code");
        const prefix = planType === "fixed"
          ? getPlanPrefix(planId)
          : getPrefixFromShiftSection(shift, section);
        const rawCode = (codeData || "").replace(/^SL-/, "");
        studentCode = prefix ? `${prefix}-${rawCode}` : rawCode;
      }

      // Audit timestamps — only for brand new students
      const auditFields = {};
      if (!existingCheck?.id) {
        const hh = nowIST.getUTCHours(), mm = nowIST.getUTCMinutes(), ss = nowIST.getUTCSeconds();
        const ampm = hh >= 12 ? "PM" : "AM";
        const h12  = String(hh % 12 || 12).padStart(2, "0");
        auditFields.registered_at   = nowIST.toISOString();
        auditFields.registered_date = todayStr;
        auditFields.registered_time = `${h12}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")} ${ampm} IST`;
      }

      const { data: s, error: e } = await supabase
        .from("students")
        .upsert({
          auth_user_id:      authUserId,
          full_name:         studentData.fullName,
          father_name:       studentData.fatherName,
          gender:            studentData.gender,
          email:             studentData.email.toLowerCase(),
          phone:             studentData.phone,
          parent_mobile:     studentData.parentMobile     || "",
          aadhar:            studentData.aadhar,
          address:           studentData.address          || "",
          permanent_address: studentData.permanentAddress || "",
          exam_target:       studentData.examTarget       || "",
          student_code:      studentCode,
          ...auditFields,
        }, { onConflict: "email" })
        .select()
        .single();

      if (e) throw new Error("Failed to save student: " + e.message);
      student = s;
    }

    // ── 7. PHOTO UPLOAD (non-blocking) ────────────────────────────
    if (photoBase64) {
      try {
        const photoUrl = await uploadStudentPhoto(supabase, student.id, photoBase64);
        if (photoUrl) await supabase.from("students").update({ photo_url: photoUrl }).eq("id", student.id);
      } catch (photoErr) {
        console.error("Photo upload failed (registration continued):", photoErr.message);
      }
    }

    // ── 8. CONFLICT CHECK ─────────────────────────────────────────
    // Check for existing active membership for this student.
    // Policy: warn in response, do not block. Admin decides.
    let conflictWarning = null;
    const { data: existingActive } = await supabase
      .from("memberships")
      .select("id, end_date, plan_id, plans(name, shift)")
      .eq("student_id", student.id)
      .eq("status", "active")
      .gte("end_date", todayStr)
      .maybeSingle();

    if (existingActive) {
      conflictWarning = {
        message:          "Student already has an active membership",
        existingPlanName: existingActive.plans?.name || existingActive.plan_id || "—",
        existingEndDate:  existingActive.end_date,
      };
    }

    // ── 9. CALCULATE END DATE ─────────────────────────────────────
    const endDate = calculateEndDate(
      startDate,
      planId || "",
      planType === "custom" ? parseInt(customDurationDays) : 0
    );

    // ── 10. PLAN LABEL (for receipt) ──────────────────────────────
    const planLabel = planType === "fixed"
      ? planRecord.name
      : `Custom ${customDurationDays} Day${parseInt(customDurationDays) > 1 ? "s" : ""} – ${shift} (${section})`;

    // ── 11. MEMBERSHIP INSERT ─────────────────────────────────────
    // amount_paid is the single source of truth. No new monetary columns added.
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id:           student.id,
        plan_id:              planType === "fixed" ? planId : null,
        fixed_seat:           fixedSeat || false,
        locker:               locker    || false,
        amount_paid:          finalAmount,
        start_date:           startDate,
        end_date:             endDate,
        status:               "active",
        payment_mode:         paymentMode || "cash",
        registration_type:    "admin_direct",
        plan_type:            planType,
        custom_duration_days: planType === "custom" ? parseInt(customDurationDays) : null,
        discount_reason:      discountReason?.trim() || null,
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // ── 12. PAYMENT LOG ───────────────────────────────────────────
    await supabase.from("payments").insert({
      student_id:    student.id,
      membership_id: membership.id,
      amount:        finalAmount,
      status:        "success",
      plan_id:       planType === "fixed" ? planId : null,
      payment_mode:  paymentMode || "cash",
    });

    // ── 13. PHOTO SIGNED URL (for receipt) ────────────────────────
    let photoSignedUrl = null;
    if (student.photo_url) {
      const { data: signed } = await supabase.storage
        .from("student-photos")
        .createSignedUrl(student.photo_url, 300);
      photoSignedUrl = signed?.signedUrl || null;
    }

    // ── 14. RESPONSE ──────────────────────────────────────────────
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:         true,
        studentId:       student.id,
        studentCode:     student.student_code,
        membershipId:    membership.id,
        startDate,
        endDate,
        conflictWarning,   // null if clean, object if duplicate existed — frontend displays
        receiptData: {
          name:           student.full_name,
          studentCode:    student.student_code,
          phone:          student.phone,
          plan:           planLabel,
          amount:         finalAmount,
          mode:           paymentMode || "cash",
          date:           new Date().toISOString(),
          id:             membership.id,
          startDate,
          endDate,
          registeredDate: student.registered_date || null,
          registeredTime: student.registered_time || null,
          photoSignedUrl,
        },
      }),
    };

  } catch (err) {
    console.error("admin-direct-register error:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// ── PHOTO UPLOAD HELPER ───────────────────────────────────────────
// Identical to cash-registration.js and verify-payment.js.
async function uploadStudentPhoto(supabase, studentId, photoBase64) {
  const match = /^data:(image\/\w+);base64,(.+)$/.exec(photoBase64 || "");
  if (!match) return null;
  const contentType = match[1];
  const ext         = contentType.split("/")[1] === "png" ? "png" : "jpg";
  const buffer      = Buffer.from(match[2], "base64");
  const filePath    = `${studentId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from("student-photos")
    .upload(filePath, buffer, { contentType, upsert: true });
  if (uploadError) throw new Error(uploadError.message);
  return filePath;
}