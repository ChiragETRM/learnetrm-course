(function () {
  const CONFIG = {
    apiBase: "https://simulator.learnetrm.com/api",
    courseId: "introduction-to-energy-trading-and-risk-management",
    registerUrl: "https://learnetrm.com/register-now",
    gateAfterTitle: "physical vs. financial trading",
    fallbackGateAfterIndex: 3,
    legacyLessonRedirects: {
      "codex-capstone-war-room": "ddgOSmrH2LyLCKK_ORAbpHiEADkQgrbP",
      "CdxCapstoneWarRoomLesson00000001": "ddgOSmrH2LyLCKK_ORAbpHiEADkQgrbP",
    },
  };

  const storage = {
    token: `${CONFIG.courseId}:course-token`,
    email: `${CONFIG.courseId}:course-email`,
    completed: `${CONFIG.courseId}:completed-lesson-ids`,
  };

  let lessons = [];
  let pendingLessonId = null;
  let saveTimer = null;
  let isGateOpen = false;

  function readJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      // Ignore storage failures; the backend remains the source of truth.
    }
  }

  function getToken() {
    try {
      return window.localStorage.getItem(storage.token) || "";
    } catch (_) {
      return "";
    }
  }

  function setToken(token) {
    try {
      window.localStorage.setItem(storage.token, token);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function clearToken() {
    try {
      window.localStorage.removeItem(storage.token);
    } catch (_) {
      // Ignore storage failures.
    }
  }

  function decodeRuntimeData(source) {
    const match = source.match(/__jsonp\("runtime-data\.js(?:\?[^\"]+)?","([^\"]+)"\)/);
    if (!match) return null;
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  }

  async function loadLessons() {
    const response = await fetch("runtime-data.js", { cache: "no-store" });
    const data = decodeRuntimeData(await response.text());
    lessons = (data && data.course && Array.isArray(data.course.lessons) ? data.course.lessons : [])
      .map((lesson, index) => ({
        id: String(lesson.id),
        title: String(lesson.title || `Lesson ${index + 1}`),
        index,
      }));
  }

  function lessonIdFromHash(hash) {
    const match = String(hash || window.location.hash).match(/^#\/lessons\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function redirectLegacyLessonHash() {
    const lessonId = lessonIdFromHash();
    const replacement = lessonId && CONFIG.legacyLessonRedirects[lessonId];
    if (!replacement) return false;
    window.location.hash = `#/lessons/${replacement}`;
    return true;
  }

  function lessonIndexFromId(id) {
    return lessons.findIndex((lesson) => lesson.id === id);
  }

  function currentLessonIndex() {
    const id = lessonIdFromHash();
    return id ? lessonIndexFromId(id) : -1;
  }

  function gateAfterIndex() {
    const target = CONFIG.gateAfterTitle.toLowerCase();
    const index = lessons.findIndex((lesson) => lesson.title.toLowerCase().includes(target));
    return index >= 0 ? index : CONFIG.fallbackGateAfterIndex;
  }

  function completedIdsThrough(indexExclusive) {
    const existing = new Set(readJson(storage.completed, []));
    lessons.slice(0, Math.max(0, indexExclusive)).forEach((lesson) => existing.add(lesson.id));
    return Array.from(existing);
  }

  function rememberCompleted(indexExclusive) {
    const completed = completedIdsThrough(indexExclusive);
    writeJson(storage.completed, completed);
    return completed;
  }

  async function api(path, options) {
    const response = await fetch(`${CONFIG.apiBase}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });
    if (!response.ok) {
      const error = new Error(`Request failed with ${response.status}`);
      error.status = response.status;
      try {
        error.body = await response.json();
      } catch (_) {
        error.body = null;
      }
      throw error;
    }
    return response.json();
  }

  function saveProgressNow() {
    const token = getToken();
    if (!token || !lessons.length) return Promise.resolve();
    const index = currentLessonIndex();
    if (index < 0) return Promise.resolve();
    const completed_lesson_ids = rememberCompleted(index);
    const lesson = lessons[index];
    return api("/course/progress", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        course_id: CONFIG.courseId,
        lesson_count: lessons.length,
        current_lesson_index: index,
        current_lesson_id: lesson.id,
        current_lesson_title: lesson.title,
        completed_lesson_ids,
      }),
    }).catch((error) => {
      if (error.status === 401) clearToken();
    });
  }

  function scheduleProgressSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveProgressNow, 500);
  }

  function injectStyles() {
    if (document.getElementById("learnetrm-course-gate-styles")) return;
    const style = document.createElement("style");
    style.id = "learnetrm-course-gate-styles";
    style.textContent = `
      .learnetrm-gate-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: grid;
        place-items: center;
        padding: 24px;
        background: rgba(15, 23, 42, 0.68);
      }
      .learnetrm-gate-dialog {
        width: min(460px, 100%);
        border-radius: 8px;
        background: #ffffff;
        color: #111827;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
        padding: 24px;
        font-family: Lato, Arial, sans-serif;
      }
      .learnetrm-gate-dialog h2 {
        margin: 0 0 8px;
        font-size: 24px;
        line-height: 1.2;
      }
      .learnetrm-gate-dialog p {
        margin: 0 0 16px;
        color: #4b5563;
        line-height: 1.45;
      }
      .learnetrm-gate-dialog label {
        display: block;
        margin-bottom: 6px;
        color: #374151;
        font-size: 14px;
        font-weight: 700;
      }
      .learnetrm-gate-dialog input {
        box-sizing: border-box;
        width: 100%;
        height: 44px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 0 12px;
        font: inherit;
      }
      .learnetrm-gate-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 16px;
      }
      .learnetrm-gate-actions button,
      .learnetrm-gate-actions a {
        border: 0;
        border-radius: 6px;
        padding: 10px 14px;
        font: inherit;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
      }
      .learnetrm-gate-primary { background: #0f172a; color: #ffffff; }
      .learnetrm-gate-secondary { background: #e5e7eb; color: #111827; }
      .learnetrm-gate-link { background: #0ea5e9; color: #ffffff; }
      .learnetrm-gate-error {
        min-height: 20px;
        margin-top: 10px;
        color: #b91c1c;
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  function closeGate() {
    const existing = document.getElementById("learnetrm-course-gate");
    if (existing) existing.remove();
    isGateOpen = false;
  }

  function openGate(targetLessonId) {
    if (isGateOpen) return;
    isGateOpen = true;
    const gateIndex = gateAfterIndex();
    pendingLessonId = targetLessonId || (lessons[gateIndex + 1] && lessons[gateIndex + 1].id);
    injectStyles();

    const backdrop = document.createElement("div");
    backdrop.id = "learnetrm-course-gate";
    backdrop.className = "learnetrm-gate-backdrop";
    backdrop.innerHTML = `
      <form class="learnetrm-gate-dialog">
        <h2>Continue with your registered email</h2>
        <p>Lessons after Physical vs. Financial Trading are available to registered 4 week workshop learners.</p>
        <label for="learnetrm-course-email">Registered email id</label>
        <input id="learnetrm-course-email" type="email" autocomplete="email" required />
        <div class="learnetrm-gate-error" role="alert"></div>
        <div class="learnetrm-gate-actions">
          <button class="learnetrm-gate-primary" type="submit">Continue</button>
          <a class="learnetrm-gate-link" href="${CONFIG.registerUrl}">Register for the 4 week workshop</a>
          <button class="learnetrm-gate-secondary" type="button" data-close>Back to course</button>
        </div>
      </form>
    `;
    document.body.appendChild(backdrop);

    const form = backdrop.querySelector("form");
    const input = backdrop.querySelector("input");
    const errorBox = backdrop.querySelector(".learnetrm-gate-error");
    const closeButton = backdrop.querySelector("[data-close]");
    const savedEmail = window.localStorage.getItem(storage.email);
    if (savedEmail) input.value = savedEmail;
    input.focus();

    closeButton.addEventListener("click", closeGate);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.textContent = "";
      const email = input.value.trim();
      if (!email) return;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Checking...";
      try {
        const result = await api("/course/access", {
          method: "POST",
          body: JSON.stringify({ email, course_id: CONFIG.courseId }),
        });
        setToken(result.access_token);
        window.localStorage.setItem(storage.email, email.toLowerCase());
        if (result.progress && Array.isArray(result.progress.completed_lesson_ids)) {
          writeJson(storage.completed, result.progress.completed_lesson_ids);
        }
        rememberCompleted(gateAfterIndex() + 1);
        closeGate();
        if (pendingLessonId) {
          window.location.hash = `#/lessons/${pendingLessonId}`;
        }
        scheduleProgressSave();
      } catch (error) {
        if (error.status === 404) {
          errorBox.innerHTML = `This email is not registered yet. <a href="${CONFIG.registerUrl}">Register for the 4 week workshop</a> to get access.`;
        } else {
          errorBox.textContent = "We could not verify this email. Please try again.";
        }
      } finally {
        submit.disabled = false;
        submit.textContent = "Continue";
      }
    });
  }

  function shouldBlockLessonId(lessonId) {
    const index = lessonIndexFromId(lessonId);
    return index > gateAfterIndex() && !getToken();
  }

  function guardCurrentRoute() {
    if (redirectLegacyLessonHash()) return;
    const lessonId = lessonIdFromHash();
    if (lessonId && shouldBlockLessonId(lessonId)) {
      const fallback = lessons[gateAfterIndex()];
      if (fallback) window.location.hash = `#/lessons/${fallback.id}`;
      openGate(lessonId);
      return;
    }
    scheduleProgressSave();
  }

  function onDocumentClick(event) {
    if (event.target.closest && event.target.closest("#learnetrm-course-gate")) {
      return;
    }

    const lessonLink = event.target.closest && event.target.closest('a[href^="#/lessons/"]');
    if (lessonLink) {
      const lessonId = lessonIdFromHash(lessonLink.getAttribute("href"));
      if (lessonId && shouldBlockLessonId(lessonId)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openGate(lessonId);
        return;
      }
    }

    const clicked = event.target.closest && event.target.closest("button, a, [role='button']");
    const label = clicked ? (clicked.innerText || clicked.textContent || "").trim().toLowerCase() : "";
    if (label === "continue") {
      const index = currentLessonIndex();
      const target = lessons[index + 1];
      if (index === gateAfterIndex() && !getToken()) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openGate(target && target.id);
        return;
      }
      rememberCompleted(index + 1);
      scheduleProgressSave();
    }
  }

  async function restoreServerProgress() {
    const token = getToken();
    if (!token) return;
    try {
      const progress = await api(`/course/progress?course_id=${encodeURIComponent(CONFIG.courseId)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (Array.isArray(progress.completed_lesson_ids)) {
        writeJson(storage.completed, progress.completed_lesson_ids);
      }
    } catch (error) {
      if (error.status === 401) clearToken();
    }
  }

  async function boot() {
    try {
      await loadLessons();
      await restoreServerProgress();
      document.addEventListener("click", onDocumentClick, true);
      window.addEventListener("hashchange", guardCurrentRoute);
      guardCurrentRoute();
    } catch (error) {
      console.warn("LearnETRM course gate failed to initialize", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
