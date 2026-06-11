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
      studentData, // { fullName, email, phone, address, examTarget }
      planId,
      amount,
      fixedSeat,
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
          email: studentData.email,
          phone: studentData.phone,
          address: studentData.address || "",
          exam_target: studentData.examTarget || "",
        },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select()
      .single();

    if (studentError) throw new Error("Failed to save student: " + studentError.message);

    // 5. Calculate membership dates
    const startDate = new Date();
    const endDate = new Date();
    if (planId.startsWith("monthly")) endDate.setMonth(endDate.getMonth() + 1);
    else if (planId.startsWith("15days")) endDate.setDate(endDate.getDate() + 15);
    else if (planId.startsWith("3month")) endDate.setMonth(endDate.getMonth() + 3);

    // 6. Create membership record
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .insert({
        student_id: student.id,
        plan_id: planId,
        fixed_seat: fixedSeat || false,
        amount_paid: amount,
        start_date: startDate.toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        status: "active",
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
        endDate: endDate.toISOString().split("T")[0],
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
