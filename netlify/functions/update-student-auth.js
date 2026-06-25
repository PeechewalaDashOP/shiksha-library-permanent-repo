// netlify/functions/update-student-auth.js
// Called by admin when editing a student's phone number.
// Updates the Supabase Auth user's password to match the new phone.
// (Student login password = their phone number — set at registration)

const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: "Method Not Allowed" };

  try {
    const { studentId, newPhone } = JSON.parse(event.body);

    if (!studentId || !newPhone) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "studentId and newPhone are required" }) };
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch the student's auth_user_id from the students table
    const { data: student, error: fetchErr } = await supabase
      .from("students")
      .select("auth_user_id, full_name")
      .eq("id", studentId)
      .single();

    if (fetchErr || !student) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Student not found" }) };
    }

    if (!student.auth_user_id) {
      // No auth account linked — nothing to update (edge case: old records)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, skipped: true }) };
    }

    // Update the Supabase Auth password to the new phone number
    const { error: authErr } = await supabase.auth.admin.updateUserById(
      student.auth_user_id,
      { password: newPhone }
    );

    if (authErr) throw new Error("Auth update failed: " + authErr.message);

    console.log(`Password updated for ${student.full_name} (${studentId})`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
