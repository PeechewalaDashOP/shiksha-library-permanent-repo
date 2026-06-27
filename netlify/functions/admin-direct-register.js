// netlify/functions/admin-direct-register.js
const { createClient } = require("@supabase/supabase-js");

// ── PREFIX FROM PLAN ID (fixed plans) ───────────────────────────
// Identical to existing getPlanPrefix in cash-registration.js
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

// ── PREFIX FROM SHIFT + SECTION (custom plans — no planId) ──────
function getPrefixFromShiftSection(shift, section) {
  const s   = (shift   || "").toLowerCase();
  const sec = (section || "").toLowerCase();
  const isPrime    = sec.includes("prime");
  const isBasement = sec.includes("basement");
  if (isPrime) {
    if (s.includes("morning"))   return "PM";
    if (s.includes("evening"))   return "PE";
    if (s.includes("full"))      return "PFD";
  }
  if (isBasement) {
    if (s.includes("morning"))   return "BM";
    if (s.includes("evening"))   return "BE";
    if (s.includes("full"))      return "BFD";
  }
  // Ground floor (default)
  if (s.includes("morning"))     return "GM";
  if (s.includes("evening"))     return "GE";
  if (s.includes("full night"))  return "GN";
  if (s.includes("full"))        return "GFD";
  return "";
}

// ── END DATE CALCULATOR ──────────────────────────────────────────
// Reuses the exact same logic as verify-payment.js and cash-registration.js.
// For custom plans: start + (days - 1), consistent with 15days pattern (+14).
// Accepts start date as YYYY-MM-DD string, returns YYYY-MM-DD string.
function calculateEndDate(startDateStr, planId, customDurationDays) {
  const [y, m, d] = startDateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d); // local date arithmetic — no timezone shift needed

  if (customDurationDays && customDurationDays > 0) {
    end.setDate(end.getDate() + (customDurationDays - 1));
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

// ── MAIN HANDLER ─────────────────────────────────────────────────
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
    // ── ADMIN AUTH CHECK ─────────────────────────────────────────
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Unauthorized" }) };
    }
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Invalid session" }) };
    }
    if (user.app_metadata?.role !== "admin") {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "Admin access required" }) };
    }

    // ── PARSE BODY ───────────────────────────────────────────────
    const {
      // Student — one of these two must be provided
      existingStudentId,  // UUID — select an existing student
      studentData,        // object — create a new student inline
      photoBase64,

      // Plan
      planType,           // 'fixed' | 'custom'
      planId,             // required for fixed plans
      customDurationDays, // required for custom plans (integer 1–365)
      shift,              // required for custom plans
      section,            // required for custom plans

      // Pricing
      amountPaid,         // final negotiated amount — stored in amount_paid
      discountReason,     // required when amountPaid < base calculated amount

      // Other
      fixedSeat,
      locker,
      startDate,          // YYYY-MM-DD, admin-entered, validated server-side
      paymentMode,        // 'cash' | 'complimentary'
    } = JSON.parse(event.body);

    // ── INPUT VALIDATION ─────────────────────────────────────────
    if (!planType || !["fixed", "custom"].includes(planType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "planType must be 'fixed' or 'custom'" }) };
    }
    if (planType === "fixed" && !planId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "planId is required for fixed plans" }) };
    }
    if (planType === "custom") {
      const days = parseInt(customDurationDays);
      if (!days || days < 1 || days > 365) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "customDurationDays must be between 1 and 365" }) };
      }
      if (!shift || !section) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "shift and section are required for custom plans" }) };
      }
    }
    if (amountPaid === undefined || amountPaid === null || Number(amountPaid) < 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid amountPaid is required" }) };
    }
    if (Number(amountPaid) === 0 && paymentMode !== "complimentary") {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Zero amount is only valid for complimentary registrations" }) };
    }
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "startDate must be in YYYY-MM-DD format" }) };
    }

    // Start date must be within ±7 days of today (IST)
    const nowIST     = new Date(new Date().getTime() + 5.5 * 60 * 60000);
    const todayStr   = nowIST.toISOString().split("T")[0];
    const minAllowed = new Date(nowIST); minAllowed.setDate(minAllowed.getDate() - 7);
    const maxAllowed = new Date(nowIST); maxAllowed.setDate(maxAllowed.getDate() + 7);
    const startObj   = new Date(startDate);
    if (startObj < minAllowed || startObj > maxAllowed) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "startDate must be within 7 days of today" }) };
    }

    if (!existingStudentId && !studentData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Either existingStudentId or studentData must be provided" }) };
    }

    // ── FETCH PLAN (fixed plans only) ────────────────────────────
    let planRecord = null;
    if (planType === "fixed") {
      const { data: p, error: pErr } = await supabase
        .from("plans")
        .select("id, name, price, duration, shift, section, is_active")
        .eq("id", planId)
        .single();
      if (pErr || !p)  return { statusCode: 400, headers, body: JSON.stringify({ error: "Plan not found" }) };
      if (!p.is_active) return { statusCode: 400, headers, body: JSON.stringify({ error: "Selected plan is inactive" }) };
      planRecord = p;
    }

    // ── STUDENT ──────────────────────────────────────────────────
    let student;

    if (existingStudentId) {
      // ── Existing student: fetch only ──────────────────────────
      const { data: s, error: e } = await supabase
        .from("students")
        .select("*")
        .eq("id", existingStudentId)
        .single();
      if (e || !s) return { statusCode: 400, headers, body: JSON.stringify({ error: "Student not found" }) };
      student = s;

    } else {
      // ── New student: same pattern as cash-registration.js ─────
      if (!studentData?.email || !studentData?.fullName || !studentData?.phone) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "fullName, email, and phone are required for new students" }) };
      }

      // Auth user (non-blocking on duplicate)
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

      // Student code — only generated for brand new students
      const { data: existingCheck } = await supabase
        .from("students")
        .select("id, student_code")
        .eq("email", studentData.email.toLowerCase())
        .maybeSingle();

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

    // ── PHOTO UPLOAD (non-blocking) ──────────────────────────────
    if (photoBase64) {
      try {
        const photoUrl = await uploadStudentPhoto(supabase, student.id, photoBase64);
        if (photoUrl) await supabase.from("students").update({ photo_url: photoUrl }).eq("id", student.id);
      } catch (photoErr) {
        console.error("Photo upload failed (registration continued):", photoErr.message);
      }
    }

    // ── CALCULATE END DATE ───────────────────────────────────────
    const endDate = calculateEndDate(
      startDate,
      planId || "",
      planType === "custom" ? parseInt(customDurationDays) : 0
    );

    // ── PLAN LABEL (for receipt display) ─────────────────────────
    // Fixed: use plan name from DB. Custom: build a readable label.
    const planLabel = planType === "fixed"
      ? planRecord.name
      : `Custom ${customDurationDays} Day${customDurationDays > 1 ? "s" : ""} – ${shift} (${section})`;

    // ── MEMBERSHIP INSERT ────────────────────────────────────────
    // status = 'active' immediately — admin direct never enters approval queue
    // registration_type = 'admin_direct' — reuses existing column, new value
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id:          student.id,
        plan_id:             planType === "fixed" ? planId : null,
        fixed_seat:          fixedSeat || false,
        locker:              locker    || false,
        amount_paid:         Number(amountPaid),
        start_date:          startDate,
        end_date:            endDate,
        status:              "active",
        payment_mode:        paymentMode || "cash",
        registration_type:   "admin_direct",
        plan_type:           planType,
        custom_duration_days: planType === "custom" ? parseInt(customDurationDays) : null,
        discount_reason:     discountReason || null,
      })
      .select()
      .single();

    if (membershipError) throw new Error("Failed to create membership: " + membershipError.message);

    // ── PAYMENT LOG ──────────────────────────────────────────────
    // status = 'success' — admin is confirming payment at point of registration
    await supabase.from("payments").insert({
      student_id:   student.id,
      membership_id: membership.id,
      amount:        Number(amountPaid),
      status:        "success",
      plan_id:       planType === "fixed" ? planId : null,
      payment_mode:  paymentMode || "cash",
    });

    // ── PHOTO SIGNED URL (for receipt) ───────────────────────────
    let photoSignedUrl = null;
    if (student.photo_url) {
      const { data: signed } = await supabase.storage
        .from("student-photos")
        .createSignedUrl(student.photo_url, 300);
      photoSignedUrl = signed?.signedUrl || null;
    }

    // ── RESPONSE ─────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success:      true,
        studentId:    student.id,
        studentCode:  student.student_code,
        membershipId: membership.id,
        startDate,
        endDate,
        // receiptData matches generateReceipt(p) parameter shape exactly
        receiptData: {
          name:           student.full_name,
          studentCode:    student.student_code,
          phone:          student.phone,
          plan:           planLabel,
          amount:         Number(amountPaid),
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

// ── PHOTO UPLOAD HELPER ──────────────────────────────────────────
// Identical to the helper in cash-registration.js and verify-payment.js
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