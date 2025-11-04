/* assets/loan.js
   - Advanced multi-step loan wizard
   - Pushes loan application to RTDB and requests server PDF/email
*/

(function() {
    const counties = ["Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita-Taveta", "Garissa", "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru", "Tharaka-Nithi", "Embu", "Kitui", "Machakos", "Makueni", "Nyandarua", "Nyeri", "Kirinyaga", "Murang'a", "Kiambu", "Turkana", "West Pokot", "Samburu", "Trans Nzoia", "Uasin Gishu", "Elgeyo-Marakwet", "Nandi", "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado", "Kericho", "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya", "Kisumu", "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi"];

    function populateCounties() {
        const sel = document.getElementById('county');
        if (!sel) return;
        sel.innerHTML = '<option value=\"\">Select county</option>';
        counties.forEach(c => { const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            sel.appendChild(o); });
    }

    function showStep(stepIdx) {
        document.querySelectorAll('.loan-step').forEach((el, idx) => {
            el.style.display = (idx === stepIdx) ? 'block' : 'none';
        });
        const prog = document.getElementById('loanProgress');
        if (prog) {
            const steps = document.querySelectorAll('.loan-step').length;
            prog.value = stepIdx;
            prog.max = steps - 1;
        }
    }

    function collectForm() {
        const data = {};
        // personal
        data.fullname = document.getElementById('la_fullname').value;
        data.phone = document.getElementById('la_phone').value;
        data.email = document.getElementById('la_email').value;
        // residence
        data.county = document.getElementById('county').value;
        data.constituency = document.getElementById('constituency').value;
        data.ward = document.getElementById('ward').value;
        data.location = document.getElementById('location').value;
        // education
        data.education = document.getElementById('education').value;
        // guarantor
        data.guarantor_name = document.getElementById('guarantor_name').value;
        data.guarantor_phone = document.getElementById('guarantor_phone').value;
        // loan
        data.loanType = document.getElementById('loanType').value;
        data.loanAmount = document.getElementById('loanAmount').value;
        data.loanPurpose = document.getElementById('loanPurpose').value;
        data.loanPeriod = document.getElementById('loanPeriod').value;
        return data;
    }

    async function submitApplication(e) {
        e && e.preventDefault();
        // get files
        const idFile = document.getElementById('file_id').files[0];
        const kraFile = document.getElementById('file_kra').files[0];
        const guarantorFile = document.getElementById('file_gua').files[0];

        // collect data
        const form = collectForm();

        // push to RTDB first
        await loadAndInitFirebase();
        const raw = localStorage.getItem('vyg_user');
        if (!raw) { alert('You must be signed in to submit an application'); return; }
        const user = JSON.parse(raw);
        form.memberUid = user.uid;
        form.createdAt = Date.now();

        const appRef = rtdb.ref('loanApplications').push();
        await appRef.set({...form, status: 'Submitted' });
        const appId = appRef.key;

        // prepare multipart to server for PDF generation & email
        const server = window.SERVER_BASE || (typeof SERVER_BASE !== 'undefined' ? SERVER_BASE : '');
        if (!server) { alert('Server URL not configured'); return; }

        const fd = new FormData();
        fd.append('product', form.loanType + ' Loan Application');
        fd.append('applicationId', appId);
        fd.append('email', form.email);
        fd.append('form', JSON.stringify(form));
        if (idFile) fd.append('idFile', idFile);
        if (kraFile) fd.append('kraFile', kraFile);
        if (guarantorFile) fd.append('guarantorFile', guarantorFile);

        try {
            const resp = await fetch(`${server}/generate-pdf`, { method: 'POST', body: fd });
            const j = await resp.json();
            if (!resp.ok) throw new Error(j.message || 'Server error');
            // Store PDF url in RTDB
            await rtdb.ref('loanApplications/' + appId + '/pdfUrl').set(j.url);
            alert('Application submitted. A copy has been emailed to you.');
            window.location.href = 'home.html';
        } catch (err) {
            console.error(err);
            alert('Submission failed: ' + (err.message || err));
        }
    }

    // helper to load firebase
    function loadAndInitFirebase() {
        return new Promise(resolve => {
            if (window.firebase && typeof initFirebase === 'function') { initFirebase();
                resolve(); } else {
                const s1 = document.createElement('script');
                s1.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-app-compat.js";
                s1.onload = () => { const s2 = document.createElement('script');
                    s2.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-auth-compat.js";
                    s2.onload = () => { const s3 = document.createElement('script');
                        s3.src = "https://www.gstatic.com/firebasejs/9.24.0/firebase-database-compat.js";
                        s3.onload = () => { initFirebase();
                            resolve(); };
                        document.head.appendChild(s3); };
                    document.head.appendChild(s2); };
                document.head.appendChild(s1);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function() {
        populateCounties();
        // steps
        let step = 0;
        showStep(step);
        document.getElementById('loanNext').addEventListener('click', () => { step++;
            showStep(step); });
        document.getElementById('loanPrev').addEventListener('click', () => { step--; if (step < 0) step = 0;
            showStep(step); });

        // prefill loan type from query
        const params = new URLSearchParams(window.location.search);
        const type = params.get('type');
        if (type) {
            const sel = document.getElementById('loanType');
            if (sel) sel.value = type;
        }

        // submit
        const form = document.getElementById('loanForm');
        if (form) form.addEventListener('submit', submitApplication);
    });
})();