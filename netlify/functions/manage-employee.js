// netlify/functions/manage-employee.js
// Lets an admin (from admin.html's new Employees tab) list/create/delete employee logins
// for a branch. Needs the service-role key (creating/deleting a Supabase Auth user requires
// it) so this can't happen client-side — the browser must never hold that key.

const { createClient } = require("@supabase/supabase-js");

// Same allowlist used by admin.html / admin-register.html / admin-direct-register.js.
const ADMIN_EMAILS = ["namangalav230@gmail.com", "mahaveerrathore112@gmail.com", "shikshalibrary1@gmail.com"];

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
    // ── 1. ADMIN AUTH CHECK — identical pattern to admin-direct-register.js ──────────
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

    // ── 2. BRANCH SCOPE — a branch-locked admin may only manage their own branch's
    // employees. A global admin (branch_id NULL) may act on any branch. This can't reuse
    // the admin_branch_id() RPC — that relies on auth.uid() context this service-role
    // connection doesn't have — so the same admins-table lookup it does is repeated here.
    const { data: adminRow } = await supabase
      .from("admins")
      .select("branch_id")
      .eq("email", user.email)
      .maybeSingle();
    const callerBranchId = adminRow?.branch_id || null;

    const { action, branchId, email, password } = JSON.parse(event.body);
    if (!branchId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "branchId is required" }) };
    }
    if (callerBranchId && callerBranchId !== branchId) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "You can only manage employees for your own branch." }) };
    }

    // ── 3. ACTIONS ────────────────────────────────────────────────────────────────
    if (action === "list") {
      const { data, error } = await supabase
        .from("employees")
        .select("email, created_at")
        .eq("branch_id", branchId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return { statusCode: 200, headers, body: JSON.stringify({ employees: data }) };
    }

    if (action === "create") {
      if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid email is required" }) };
      }
      if (!password || password.length < 6) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Password must be at least 6 characters" }) };
      }

      const { data: existing } = await supabase
        .from("employees")
        .select("email")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      if (existing) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "This email is already an employee." }) };
      }

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: email.toLowerCase(),
        password,
        email_confirm: true,
      });
      if (createErr) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Could not create login: " + createErr.message }) };
      }

      const { error: insertErr } = await supabase.from("employees").insert({
        email: email.toLowerCase(),
        branch_id: branchId,
        auth_user_id: created.user.id,
      });
      if (insertErr) {
        // Roll back the auth user so we don't leave an orphaned login with no employees row.
        await supabase.auth.admin.deleteUser(created.user.id);
        throw new Error(insertErr.message);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (action === "delete") {
      if (!email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "email is required" }) };
      }
      const { data: row, error: fetchErr } = await supabase
        .from("employees")
        .select("auth_user_id")
        .eq("email", email.toLowerCase())
        .eq("branch_id", branchId)
        .maybeSingle();
      if (fetchErr || !row) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Employee not found in this branch" }) };
      }

      await supabase.from("employees").delete().eq("email", email.toLowerCase()).eq("branch_id", branchId);
      if (row.auth_user_id) {
        await supabase.auth.admin.deleteUser(row.auth_user_id);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
