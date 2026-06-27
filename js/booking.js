// ============================================================
// SHIKSHA LIBRARY — BOOKING + PAYMENT SYSTEM v2
// ============================================================

const RAZORPAY_KEY_ID   = "rzp_live_T39pzRZjzRApFM";
const SUPABASE_URL = "https://ojmxqckunnpthgftwbkq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_j8mlu6_1po8jUo3k5tpMrw_l7Wq74VS";

const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Fetch live prices from Supabase on page load
async function loadLivePrices() {
  try {
    const { data: plans } = await sbClient.from("plans").select("id, price");
    if (plans?.length) {
      plans.forEach(p => {
        if (PLANS[p.id]) PLANS[p.id].price = p.price;
      });
    }
  } catch(e) {
    console.log("Using default prices:", e);
  }
}

const PLANS = {
  "monthly-morning-regular":  { name: "Morning Shift",        duration: "1 Month",  shift: "Morning Regular Section – 1 Month",   price: 500  },
  "monthly-evening-regular":  { name: "Evening Shift",        duration: "1 Month",  shift: "Evening Regular Section – 1 Month",   price: 600  },
  "monthly-fullday-regular":  { name: "Full Day",             duration: "1 Month",  shift: "Full Day Regular Section – 1 Month",  price: 1000 },
  "monthly-morning-prime":    { name: "Prime Morning Shift",  duration: "1 Month",  shift: "Morning Premium Hall – 1 Month",      price: 600  },
  "monthly-evening-prime":    { name: "Prime Evening Shift",  duration: "1 Month",  shift: "Evening Premium Hall – 1 Month",      price: 700  },
  "monthly-fullday-prime":    { name: "Prime Full Day",       duration: "1 Month",  shift: "Full Day Premium Hall – 1 Month",     price: 1200 },
  "15days-morning-regular":   { name: "Morning Shift",        duration: "15 Days",  shift: "Morning Regular Section – 15 Days",   price: 300  },
  "15days-evening-regular":   { name: "Evening Shift",        duration: "15 Days",  shift: "Evening Regular Section – 15 Days",   price: 350  },
  "15days-fullday-regular":   { name: "Full Day",             duration: "15 Days",  shift: "Full Day Regular Section – 15 Days",  price: 600  },
  "15days-morning-prime":     { name: "Prime Morning Shift",  duration: "15 Days",  shift: "Morning Premium Hall – 15 Days",      price: 350  },
  "15days-evening-prime":     { name: "Prime Evening Shift",  duration: "15 Days",  shift: "Evening Premium Hall – 15 Days",      price: 400  },
  "3month-morning-regular":   { name: "Morning Shift",        duration: "3 Months", shift: "Morning Regular Section – 3 Months",  price: 1200 },
  "3month-evening-regular":   { name: "Evening Shift",        duration: "3 Months", shift: "Evening Regular Section – 3 Months",  price: 1500 },
  "3month-fullday-regular":   { name: "Full Day",             duration: "3 Months", shift: "Full Day Regular Section – 3 Months", price: 2700 },
  "3month-morning-prime":     { name: "Prime Morning Shift",  duration: "3 Months", shift: "Morning Premium Hall – 3 Months",     price: 1500 },
  "3month-evening-prime":     { name: "Prime Evening Shift",  duration: "3 Months", shift: "Evening Premium Hall – 3 Months",     price: 1800 },
  "3month-fullday-prime":     { name: "Prime Full Day",       duration: "3 Months", shift: "Full Day Premium Hall – 3 Months",    price: 3300 },
  "monthly-morning-basement": { name: "Basement Morning Shift", duration: "1 Month",  shift: "Morning Basement Section – 1 Month",  price: 400  },
  "monthly-evening-basement": { name: "Basement Evening Shift", duration: "1 Month",  shift: "Evening Basement Section – 1 Month",  price: 500  },
  "monthly-fullday-basement": { name: "Basement Full Day",      duration: "1 Month",  shift: "Full Day Basement Section – 1 Month", price: 800  },
  "15days-morning-basement":  { name: "Basement Morning Shift", duration: "15 Days",  shift: "Morning Basement Section – 15 Days",  price: 240  },
  "15days-evening-basement":  { name: "Basement Evening Shift", duration: "15 Days",  shift: "Evening Basement Section – 15 Days",  price: 290  },
  "15days-fullday-basement":  { name: "Basement Full Day",      duration: "15 Days",  shift: "Full Day Basement Section – 15 Days", price: 480  },
  "3month-morning-basement":  { name: "Basement Morning Shift", duration: "3 Months", shift: "Morning Basement Section – 3 Months", price: 960  },
  "3month-evening-basement":  { name: "Basement Evening Shift", duration: "3 Months", shift: "Evening Basement Section – 3 Months", price: 1250 },
  "3month-fullday-basement":  { name: "Basement Full Day",      duration: "3 Months", shift: "Full Day Basement Section – 3 Months", price: 2160 },
  // Feature 6: Full Night plan — Ground Floor, Monthly only
  "monthly-fullnight-regular": { name: "Full Night",           duration: "1 Month",  shift: "Full Night Ground Floor – 10PM to 6AM", price: 400 },
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadLivePrices();
  document.body.insertAdjacentHTML("beforeend", getModalHTML());
  attachBookingListeners();
  checkLoggedInUser();
});

function attachBookingListeners() {
  document.querySelectorAll('[data-plan-id]').forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const planId = btn.dataset.planId;
      const planData = PLANS[planId];
      if (!planData) {
        alert("This plan is temporarily unavailable. Please refresh the page and try again, or contact the library.");
        return;
      }
      openBookingModal(planId, planData);
    });
  });

  document.querySelectorAll('a.btn-gold, a.btn-primary, a[href*="wa.me"]').forEach((btn) => {
    if (btn.dataset.planId) return;
    const text = btn.textContent.trim().toLowerCase();
    if (!text.includes("book") && !text.includes("join") && !text.includes("start")) return;
    btn.setAttribute("href", "javascript:void(0)");
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const plansSection = document.querySelector("#plans");
      if (plansSection) plansSection.scrollIntoView({ behavior: "smooth" });
    });
  });
}

let currentPlan = {};
async function checkExistingActiveMembership(email, phone) {
  try {
    const today = new Date(new Date().getTime() + 5.5*60*60000).toISOString().split("T")[0];

    const { data: byEmail } = await sbClient
      .from("students")
      .select("id")
      .eq("email", email.toLowerCase())
      .maybeSingle();

    if (byEmail) {
      const { data: active } = await sbClient
        .from("memberships")
        .select("end_date")
        .eq("student_id", byEmail.id)
        .eq("status", "active")
        .gte("end_date", today)
        .maybeSingle();
      if (active) return active;
    }

    const { data: byPhone } = await sbClient
      .from("students")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    if (byPhone) {
      const { data: active } = await sbClient
        .from("memberships")
        .select("end_date")
        .eq("student_id", byPhone.id)
        .eq("status", "active")
        .gte("end_date", today)
        .maybeSingle();
      if (active) return active;
    }

    return null;
  } catch(e) {
    return null;
  }
}

function openBookingModal(planId, planData) {
  currentPlan = { planId, ...planData, fixedSeat: false, locker: false, photoBase64: null };
  document.getElementById("sl-modal-plan-name").textContent = planData.name + " — " + planData.duration;
  document.getElementById("sl-plan-id-hidden").value  = planId;
  document.getElementById("sl-plan-base-price").value = planData.price;
  document.getElementById("sl-booking-form").reset();
  document.getElementById("sl-shift-display").value   = planData.shift;
  document.getElementById("sl-fixed-seat").checked    = false;
  document.getElementById("sl-locker").checked        = false;
  document.getElementById("sl-form-error").textContent = "";
  resetPhotoUI();
  updateMembershipDates();
  updateTotalPrice();
  document.getElementById("sl-booking-modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeBookingModal() {
  document.getElementById("sl-booking-modal").style.display = "none";
  document.body.style.overflow = "";
}

function updateTotalPrice() {
  const base      = parseInt(document.getElementById("sl-plan-base-price").value) || 0;
  const fixedSeat = document.getElementById("sl-fixed-seat").checked;
  const locker    = document.getElementById("sl-locker").checked;
  const subtotal  = base + (fixedSeat ? 100 : 0) + (locker ? 100 : 0);
  const payMode   = document.querySelector('input[name="sl-pay-mode"]:checked')?.value || "cash";
  const gatewayFee = payMode === "online" ? Math.round(base * 0.0236) : 0;
  const total = subtotal + gatewayFee;

  currentPlan.subtotal   = subtotal;
  currentPlan.gatewayFee = gatewayFee;
  currentPlan.finalPrice = total;
  currentPlan.fixedSeat  = fixedSeat;
  currentPlan.locker     = locker;

  document.getElementById("sl-subtotal").textContent     = "₹" + subtotal.toLocaleString();
  document.getElementById("sl-gateway-row").style.display = payMode === "online" ? "flex" : "none";
  document.getElementById("sl-gateway-fee").textContent  = "₹" + gatewayFee.toLocaleString();
  document.getElementById("sl-total-price").textContent  = "₹" + total.toLocaleString();
  document.getElementById("sl-submit-price").textContent = "₹" + total.toLocaleString();
}

// ── FEATURE 1 FIX: Correct membership cycle rule ──────────────────
// Rule: start = Day 1, end = one day before same date next cycle
// monthly : +1 month  then -1 day  →  25 Jun → 24 Jul
// 15days  : +14 days               →  25 Jun → 09 Jul
// 3month  : +3 months then -1 day  →  25 Jun → 24 Sep
function updateMembershipDates() {
  const planId     = document.getElementById("sl-plan-id-hidden").value;
  const startInput = document.getElementById("sl-start-date").value;
  const nowIST = new Date(new Date().getTime() + 5.5*60*60000);
  const start  = startInput ? new Date(startInput + "T00:00:00") : new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());
  const end        = new Date(start);
  if (planId.startsWith("monthly"))     { end.setMonth(end.getMonth() + 1); end.setDate(end.getDate() - 1); }
  else if (planId.startsWith("15days")) end.setDate(end.getDate() + 14);
  else if (planId.startsWith("3month")) { end.setMonth(end.getMonth() + 3); end.setDate(end.getDate() - 1); }
  const fmt = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  document.getElementById("sl-date-display").value = `From ${fmt(start)} to ${fmt(end)}`;
  const toIST = (d) => { const x = new Date(d.getTime() + 5.5*60*60000); return x.toISOString().split("T")[0]; };
  currentPlan.startDate = toIST(start);
  currentPlan.endDate   = toIST(end);
}

function resetPhotoUI() {
  const input   = document.getElementById("sl-photo-input");
  const preview = document.getElementById("sl-photo-preview");
  const prompt  = document.getElementById("sl-photo-prompt");
  if (input) input.value = "";
  if (preview) { preview.src = ""; preview.style.display = "none"; }
  if (prompt) prompt.style.display = "flex";
  if (typeof currentPlan === "object") currentPlan.photoBase64 = null;
}

function handlePhotoSelected(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showFormError("Please select a valid image file.");
    resetPhotoUI();
    return;
  }

  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1000;
      let { width, height } = img;
      if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
      else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      currentPlan.photoBase64 = dataUrl;

      const preview = document.getElementById("sl-photo-preview");
      const prompt  = document.getElementById("sl-photo-prompt");
      if (preview) { preview.src = dataUrl; preview.style.display = "block"; }
      if (prompt) prompt.style.display = "none";
      document.getElementById("sl-form-error").textContent = "";
    };
    img.onerror = () => { showFormError("Could not read that image. Please try another."); resetPhotoUI(); };
    img.src = ev.target.result;
  };
  reader.onerror = () => { showFormError("Could not read that file. Please try again."); resetPhotoUI(); };
  reader.readAsDataURL(file);
}

async function handleBookingSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById("sl-submit-btn");
  const err = document.getElementById("sl-form-error");
  err.textContent = "";
  btn.disabled = true;
  btn.innerHTML = "Processing... <span id='sl-submit-price'></span>";

  const studentData = {
    fullName   : document.getElementById("sl-name").value.trim(),
    fatherName : document.getElementById("sl-father").value.trim(),
    gender     : document.querySelector('input[name="sl-gender"]:checked')?.value || "",
    email      : document.getElementById("sl-email").value.trim().toLowerCase(),
    phone      : document.getElementById("sl-phone").value.trim(),
    parentMobile : document.getElementById("sl-parent-mobile").value.trim(),
    aadhar     : document.getElementById("sl-aadhar").value.trim(),
    address    : document.getElementById("sl-address").value.trim(),
    permanentAddress : document.getElementById("sl-permanent-address").value.trim(),
    examTarget : document.getElementById("sl-exam").value.trim(),
  };

  if (!studentData.gender) { showFormError("Please select gender."); resetBtn(btn); return; }
  if (!/^[0-9]{10}$/.test(studentData.parentMobile)) { showFormError("Please enter a valid 10-digit parent mobile number."); resetBtn(btn); return; }
  if (studentData.aadhar.length !== 12) { showFormError("Please enter valid 12-digit Aadhar number."); resetBtn(btn); return; }
  if (!currentPlan.photoBase64) { showFormError("Please upload your photo (selfie) to continue."); resetBtn(btn); return; }

  const existingActive = await checkExistingActiveMembership(studentData.email, studentData.phone);
  if (existingActive) {
    const expiry = new Date(existingActive.end_date).toLocaleDateString("en-IN", { day:"numeric", month:"long", year:"numeric" });
    showFormError(`You already have an active membership valid until ${expiry}. Please renew from your dashboard after it expires.`);
    resetBtn(btn);
    return;
  }

  const payMode = document.querySelector('input[name="sl-pay-mode"]:checked')?.value || "cash";

  if (payMode === "cash") {
    try {
      const res  = await fetch("/.netlify/functions/cash-registration", {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          studentData, planId: currentPlan.planId, amount: currentPlan.finalPrice,
          fixedSeat: currentPlan.fixedSeat, locker: currentPlan.locker,
          startDate: currentPlan.startDate, endDate: currentPlan.endDate,
          photoBase64: currentPlan.photoBase64 || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        closeBookingModal();
        showCashSuccessModal(studentData);
      } else throw new Error(data.error || "Registration failed");
    } catch(ex) {
      showFormError(ex.message || "Something went wrong.");
    } finally { resetBtn(btn); }
    return;
  }

  try {
    const orderRes  = await fetch("/.netlify/functions/create-order", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({ amount: currentPlan.finalPrice, planId: currentPlan.planId, planName: currentPlan.name }),
    });
    const orderData = await orderRes.json();
    if (!orderData.orderId) throw new Error("Could not create order. Try again.");

    const rzp = new Razorpay({
      key        : RAZORPAY_KEY_ID,
      amount     : orderData.amount,
      currency   : "INR",
      name       : "Shiksha Library",
      description: currentPlan.name + " — " + currentPlan.duration,
      order_id   : orderData.orderId,
      prefill    : { name: studentData.fullName, email: studentData.email, contact: studentData.phone },
      theme      : { color: "#f59e0b" },
      handler    : async (response) => { await verifyAndSave(response, studentData, orderData.orderId); },
      modal      : {
        ondismiss: () => {
          showFormError("Payment was cancelled. You can try again anytime.");
          document.getElementById("sl-booking-modal").style.display = "flex";
          document.body.style.overflow = "hidden";
        },
      },
    });
    rzp.open();
    closeBookingModal();
  } catch (ex) {
    showFormError(ex.message || "Something went wrong. Please try again.");
  } finally {
    resetBtn(btn);
  }
}

function showFormError(msg) { document.getElementById("sl-form-error").textContent = msg; }

function updatePayBtn() {
  updateTotalPrice();
  const mode = document.querySelector('input[name="sl-pay-mode"]:checked')?.value;
  const btn  = document.getElementById("sl-submit-btn");
  const price = "₹" + (currentPlan.finalPrice || 0).toLocaleString();
  if (mode === "cash") {
    btn.style.background = "#16a34a";
    btn.innerHTML = 'Register & Pay Cash at Library <span id="sl-submit-price">' + price + '</span>';
  } else {
    btn.style.background = "#f59e0b";
    btn.innerHTML = 'Proceed to Pay <span id="sl-submit-price">' + price + '</span>';
  }
}

function resetBtn(btn) {
  btn.disabled = false;
  const mode = document.querySelector('input[name="sl-pay-mode"]:checked')?.value;
  const price = "₹" + (currentPlan.finalPrice || 0).toLocaleString();
  if (mode === "cash") {
    btn.style.background = "#16a34a";
    btn.innerHTML = 'Register & Pay Cash at Library <span id="sl-submit-price">' + price + '</span>';
  } else {
    btn.style.background = "#f59e0b";
    btn.innerHTML = 'Proceed to Pay <span id="sl-submit-price">' + price + '</span>';
  }
}

async function verifyAndSave(razorpayResponse, studentData, orderId) {
  showLoader("Verifying payment...");
  try {
    const res  = await fetch("/.netlify/functions/verify-payment", {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        razorpay_order_id  : orderId,
        razorpay_payment_id: razorpayResponse.razorpay_payment_id,
        razorpay_signature : razorpayResponse.razorpay_signature,
        studentData, planId: currentPlan.planId, amount: currentPlan.finalPrice,
        fixedSeat: currentPlan.fixedSeat, locker: currentPlan.locker,
        startDate: currentPlan.startDate, endDate: currentPlan.endDate,
        photoBase64: currentPlan.photoBase64 || null,
      }),
    });
    const data = await res.json();
    if (data.success) showSuccessModal(studentData, data);
    else throw new Error(data.error || "Verification failed");
  } catch (ex) {
    hideLoader();
    alert("Payment received but registration failed. Contact us with payment ID: " + razorpayResponse.razorpay_payment_id);
  }
}

function showSuccessModal(studentData, data) {
  hideLoader();
  document.getElementById("sl-success-name").textContent   = studentData.fullName;
  document.getElementById("sl-success-plan").textContent   = currentPlan.name + " — " + currentPlan.duration;
  document.getElementById("sl-success-expiry").textContent = formatDate(data.endDate || currentPlan.endDate);
  document.getElementById("sl-success-email").textContent  = studentData.email;
  document.getElementById("sl-success-pwd").textContent    = data.isNewUser
    ? "Your password: " + studentData.phone + " (your phone number)"
    : "Use your existing password to login.";
  document.getElementById("sl-success-modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function showCashSuccessModal(studentData) {
  document.getElementById("sl-success-name").textContent   = studentData.fullName;
  document.getElementById("sl-success-plan").textContent   = currentPlan.name + " — " + currentPlan.duration;
  document.getElementById("sl-success-expiry").textContent = formatDate(currentPlan.endDate);
  document.getElementById("sl-success-email").textContent  = studentData.email;
  document.getElementById("sl-success-pwd").textContent    = "Your account password is your phone number. Please visit the library and pay ₹" + currentPlan.finalPrice + " in cash to activate your membership.";
  document.getElementById("sl-stitle").textContent = "Registration Submitted!";
  document.getElementById("sl-sicon").textContent = "✅";
  document.getElementById("sl-success-modal").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeSuccessModal() {
  document.getElementById("sl-success-modal").style.display = "none";
  document.body.style.overflow = "";
}

function showLoader(msg) {
  document.getElementById("sl-loader-text").textContent = msg || "Please wait...";
  document.getElementById("sl-loader-modal").style.display = "flex";
}

function hideLoader() { document.getElementById("sl-loader-modal").style.display = "none"; }

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

async function checkLoggedInUser() {
  try {
    const { data: { session } } = await sbClient.auth.getSession();
  } catch(e) {}
}

function getModalHTML() {
  const _d = new Date(); _d.setTime(_d.getTime() + (5.5*60*60000));
  const today = _d.toISOString().split('T')[0];
  const _7ago = new Date(_d.getTime() - 7*24*60*60000);
  const sevenDaysAgo = _7ago.toISOString().split('T')[0];
  return `
  <style>
    .sl-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;align-items:center;justify-content:center;padding:1rem}
    .sl-box{background:#fff;border-radius:16px;padding:2rem;width:100%;max-width:500px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 25px 60px rgba(0,0,0,0.35)}
    .sl-close{position:absolute;top:1rem;right:1rem;background:none;border:none;font-size:1.6rem;cursor:pointer;color:#666;line-height:1}
    .sl-title{font-size:1.3rem;font-weight:800;color:#1e293b;margin:0 0 .25rem;font-family:inherit}
    .sl-badge{display:inline-block;background:#fef3c7;color:#92400e;padding:.25rem .75rem;border-radius:999px;font-size:.82rem;font-weight:600;margin-bottom:1rem}
    .sl-price-row{display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border-radius:10px;padding:.75rem 1rem;margin-bottom:1.25rem}
    .sl-price-label{color:#64748b;font-size:.9rem}
    .sl-price-total{font-size:1.4rem;font-weight:800;color:#f59e0b}
    .sl-fg{margin-bottom:.9rem}
    .sl-fg label{display:block;font-size:.83rem;font-weight:600;color:#374151;margin-bottom:.35rem}
    .sl-fg input,.sl-fg select{width:100%;padding:.65rem .9rem;border:1.5px solid #e2e8f0;border-radius:8px;font-size:.92rem;outline:none;transition:border .2s;box-sizing:border-box;font-family:inherit}
    .sl-fg input:focus,.sl-fg select:focus{border-color:#f59e0b}
    .sl-fg input[readonly]{background:#f8fafc;color:#64748b;cursor:not-allowed}
    .sl-radio-row{display:flex;gap:1rem;margin-top:.35rem}
    .sl-radio-row label{display:flex;align-items:center;gap:.4rem;font-size:.9rem;color:#374151;font-weight:500;cursor:pointer}
    .sl-radio-row input[type=radio]{accent-color:#f59e0b;width:16px;height:16px}
    .sl-check-row{display:flex;align-items:flex-start;gap:.65rem;background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;padding:.75rem 1rem;margin-bottom:.85rem;cursor:pointer}
    .sl-check-row input[type=checkbox]{width:18px;height:18px;accent-color:#f59e0b;cursor:pointer;margin-top:2px;flex-shrink:0}
    .sl-check-label{font-size:.88rem;color:#374151;flex:1}
    .sl-check-label span{font-weight:700;color:#d97706}
    .sl-divider{border:none;border-top:1px solid #e2e8f0;margin:.9rem 0}
    .sl-submit{width:100%;padding:.85rem;background:#f59e0b;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;transition:background .2s;margin-top:.25rem;font-family:inherit}
    .sl-submit:hover{background:#d97706}
    .sl-submit:disabled{background:#fcd34d;cursor:not-allowed}
    .sl-err{color:#dc2626;font-size:.83rem;margin-top:.4rem;text-align:center;min-height:1.2em}
    .sl-date-box{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px;padding:.65rem 1rem;margin-bottom:.9rem}
    .sl-date-box label{font-size:.8rem;font-weight:600;color:#15803d;display:block;margin-bottom:.3rem}
    .sl-date-box input{width:100%;background:transparent;border:none;outline:none;font-size:.9rem;color:#1e293b;font-weight:600;font-family:inherit;cursor:not-allowed}
    .sl-sbox{background:#fff;border-radius:16px;padding:2.5rem;width:100%;max-width:440px;text-align:center}
    .sl-sicon{font-size:3.5rem;margin-bottom:.75rem}
    .sl-stitle{font-size:1.4rem;font-weight:800;color:#15803d;margin:0 0 .4rem}
    .sl-ssub{color:#64748b;font-size:.92rem;margin-bottom:1.25rem}
    .sl-scard{background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;padding:1.25rem;text-align:left;margin-bottom:1.25rem}
    .sl-srow{display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.4rem}
    .sl-srow:last-child{margin-bottom:0}
    .sl-skey{color:#64748b}
    .sl-sval{font-weight:600;color:#1e293b;text-align:right;max-width:60%}
    .sl-hint{background:#fef3c7;border-radius:8px;padding:.7rem 1rem;font-size:.83rem;color:#92400e;margin-bottom:1.25rem}
    .sl-sbtns{display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap}
    .sl-btn-o{padding:.6rem 1.25rem;border:2px solid #f59e0b;background:#fff;color:#d97706;border-radius:8px;font-weight:600;cursor:pointer;font-size:.88rem;text-decoration:none}
    .sl-btn-f{padding:.6rem 1.25rem;background:#f59e0b;border:none;color:#fff;border-radius:8px;font-weight:600;cursor:pointer;font-size:.88rem;text-decoration:none}
    .sl-lbox{background:#fff;border-radius:16px;padding:2.5rem;text-align:center;min-width:220px}
    .sl-spin{width:46px;height:46px;border:5px solid #fde68a;border-top-color:#f59e0b;border-radius:50%;animation:sl-spin .7s linear infinite;margin:0 auto 1rem}
    @keyframes sl-spin{to{transform:rotate(360deg)}}
  </style>

  <div class="sl-overlay" id="sl-booking-modal" onclick="if(event.target===this)closeBookingModal()">
    <div class="sl-box">
      <button class="sl-close" onclick="closeBookingModal()">×</button>
      <p class="sl-title">Complete Your Registration</p>
      <div class="sl-badge" id="sl-modal-plan-name">Plan</div>
      <div class="sl-price-row" style="flex-direction:column;gap:6px;align-items:stretch">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;color:#64748b">
          <span>Membership Fee</span>
          <span id="sl-subtotal">₹0</span>
        </div>
        <div id="sl-gateway-row" style="display:flex;justify-content:space-between;font-size:.85rem;color:#64748b">
          <span>Platform Gateway Fee (2.36%)</span>
          <span id="sl-gateway-fee">₹0</span>
        </div>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:2px 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="sl-price-label">Total Amount</span>
          <span class="sl-price-total" id="sl-total-price">₹0</span>
        </div>
      </div>
      <form id="sl-booking-form" onsubmit="handleBookingSubmit(event)">
        <input type="hidden" id="sl-plan-id-hidden">
        <input type="hidden" id="sl-plan-base-price">
        <div class="sl-fg"><label>Full Name *</label><input type="text" id="sl-name" placeholder="Enter your full name" required></div>
        <div class="sl-fg"><label>Father's Name *</label><input type="text" id="sl-father" placeholder="Enter father's full name" required></div>
        <div class="sl-fg">
          <label>Gender *</label>
          <div class="sl-radio-row">
            <label><input type="radio" name="sl-gender" value="Male"> Male</label>
            <label><input type="radio" name="sl-gender" value="Female"> Female</label>
          </div>
        </div>
        <div class="sl-fg"><label>Email Address *</label><input type="email" id="sl-email" placeholder="your@email.com" required></div>
        <div class="sl-fg"><label>Phone Number *</label><input type="tel" id="sl-phone" placeholder="10-digit mobile number" pattern="[6-9][0-9]{9}" required></div>
        <div class="sl-fg"><label>Parent's Mobile Number *</label><input type="tel" id="sl-parent-mobile" placeholder="10-digit parent mobile number" pattern="[0-9]{10}" maxlength="10" required title="Please enter a valid 10-digit mobile number"></div>
        <div class="sl-fg"><label>Aadhar Card Number *</label><input type="text" id="sl-aadhar" placeholder="12-digit Aadhar number" maxlength="12" pattern="[0-9]{12}" required></div>
        <div class="sl-fg"><label>Residential Address *</label><input type="text" id="sl-address" placeholder="Full address" required></div>
        <div class="sl-fg"><label>Permanent Address *</label><textarea id="sl-permanent-address" placeholder="Permanent address" required rows="3"></textarea></div>
        <div class="sl-fg">
          <label>Your Photo (Selfie) *</label>
          <input type="file" id="sl-photo-input" accept="image/*" capture="user" style="display:none" onchange="handlePhotoSelected(this)">
          <div id="sl-photo-wrap" onclick="document.getElementById('sl-photo-input').click()" style="cursor:pointer;border:1.5px dashed #f59e0b;border-radius:10px;padding:1rem;text-align:center;background:#fffbeb">
            <div id="sl-photo-prompt" style="display:flex;flex-direction:column;align-items:center;gap:.35rem;color:#92400e">
              <span style="font-size:1.8rem">📷</span>
              <span style="font-size:.85rem;font-weight:600">Tap to take a selfie / upload photo</span>
              <span style="font-size:.72rem;color:#b45309">Required for verification</span>
            </div>
            <img id="sl-photo-preview" alt="Your photo" style="display:none;max-width:160px;max-height:160px;border-radius:10px;margin:0 auto;object-fit:cover">
          </div>
          <p style="font-size:.72rem;color:#94a3b8;margin-top:.35rem;text-align:center">Tap the box again to retake / change photo</p>
        </div>
        <div class="sl-fg">
          <label>Exam Preparing For</label>
          <select id="sl-exam">
            <option value="">Select exam (optional)</option>
            <option>IIT JEE</option><option>NEET</option><option>UPSC</option>
            <option>SSC CGL</option><option>Banking / Railway</option>
            <option>GATE</option><option>CUET</option><option>Board Exams</option><option>Other</option>
          </select>
        </div>
        <div class="sl-fg"><label>Shift & Section (Auto-filled)</label><input type="text" id="sl-shift-display" readonly></div>
        <hr class="sl-divider">
        <div class="sl-fg"><label>Membership Start Date (upto 7 days back allowed)</label><input type="date" id="sl-start-date" onchange="updateMembershipDates()" min="${sevenDaysAgo}" value="${today}"></div>
        <div class="sl-date-box">
          <label>📅 Membership Period (Auto-calculated)</label>
          <input type="text" id="sl-date-display" readonly>
        </div>
        <hr class="sl-divider">
        <label class="sl-check-row">
          <input type="checkbox" id="sl-fixed-seat" onchange="updateTotalPrice()">
          <span class="sl-check-label">Add Fixed Seat Reservation &nbsp;<span>+₹100</span><br><small style="color:#6b7280;font-weight:400">Same seat guaranteed every day</small></span>
        </label>
        <label class="sl-check-row">
          <input type="checkbox" id="sl-locker" onchange="updateTotalPrice()">
          <span class="sl-check-label">Add Locker &nbsp;<span>+₹100</span><br><small style="color:#6b7280;font-weight:400">Personal locker for your belongings</small></span>
        </label>
        <div style="margin-top:1.1rem;text-align:center">
          <p style="font-size:.78rem;color:#64748b;font-weight:600;margin-bottom:.5rem">📷 Scan QR Code to Pay</p>
          <img src="assets/payment-qr.jpg" alt="Scan to pay via UPI" style="width:220px;max-width:100%;height:auto;border-radius:10px;border:1px solid #e2e8f0;margin:0 auto;display:block;background:#fff">
          <div style="display:flex;align-items:center;gap:.6rem;margin:.85rem 0;color:#94a3b8;font-size:.75rem;font-weight:700">
            <span style="flex:1;height:1px;background:#e2e8f0"></span>
            OR
            <span style="flex:1;height:1px;background:#e2e8f0"></span>
          </div>
          <a href="upi://pay?pa=AS59757001@mairtel&pn=Shiksha%20Library&cu=INR&tn=Shiksha%20Library%20Registration" class="sl-btn-f" style="display:inline-block;text-decoration:none">🟢 Open Payment App</a>
          <p style="font-size:.72rem;color:#64748b;margin-top:.65rem">Pay using either option above, then submit the form below.</p>
        </div>
        <p class="sl-err" id="sl-form-error"></p>
        <button type="submit" class="sl-submit" id="sl-submit-btn"> submit your registration <span id="sl-submit-price">₹0</span></button>
        <div style="margin-top:1rem;border:1.5px solid #e2e8f0;border-radius:10px;overflow:hidden">
          <div style="background:#f8fafc;padding:.6rem 1rem;font-size:.82rem;font-weight:700;color:#374151">Choose Payment Method</div>
          <label style="display:none;align-items:center;gap:.75rem;padding:.75rem 1rem;cursor:pointer;border-bottom:1px solid #f1f5f9">
            <input type="radio" name="sl-pay-mode" value="online" disabled onchange="updatePayBtn()" style="accent-color:#f59e0b;width:16px;height:16px">
            <span style="font-size:.9rem;color:#1e293b;font-weight:500">💳 Pay Online (UPI / Card / Net Banking)</span>
          </label>
          <label style="display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;cursor:pointer">
            <input type="radio" name="sl-pay-mode" value="cash" checked onchange="updatePayBtn()" style="accent-color:#f59e0b;width:16px;height:16px">
            <span style="font-size:.9rem;color:#1e293b;font-weight:500">🏦 Pay at Library (Cash)</span>
          </label>
        </div>
        <p style="text-align:center;font-size:.76rem;color:#94a3b8;margin-top:.6rem">🔒 Payments secured</p>
      </form>
    </div>
  </div>

  <div class="sl-overlay" id="sl-success-modal">
    <div class="sl-sbox">
      <div class="sl-sicon" id="sl-sicon">🎉</div>
      <h2 class="sl-stitle" id="sl-stitle">Booking Confirmed!</h2>
      <p class="sl-ssub">Welcome to Shiksha Library, <strong id="sl-success-name"></strong>!</p>
      <div class="sl-scard">
        <div class="sl-srow"><span class="sl-skey">Plan</span><span class="sl-sval" id="sl-success-plan"></span></div>
        <div class="sl-srow"><span class="sl-skey">Valid Until</span><span class="sl-sval" id="sl-success-expiry"></span></div>
        <div class="sl-srow"><span class="sl-skey">Login Email</span><span class="sl-sval" id="sl-success-email"></span></div>
      </div>
      <div class="sl-hint" id="sl-success-pwd"></div>
      <div class="sl-sbtns">
        <button class="sl-btn-o" onclick="closeSuccessModal()">Close</button>
        <a class="sl-btn-f" href="dashboard.html">Go to My Account →</a>
      </div>
    </div>
  </div>

  <div class="sl-overlay" id="sl-loader-modal">
    <div class="sl-lbox">
      <div class="sl-spin"></div>
      <p id="sl-loader-text" style="color:#374151;font-weight:600">Please wait...</p>
    </div>
  </div>`;
}