
(() => {
  "use strict";

  // ========================================
  // TanChat - Supabase Chat
  // Username/password auth via Edge Function
  // ========================================

  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_KEY = window.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("[TanChat] Supabase configuration is missing.");
    alert("TanChat configuration is missing. Check config.js.");
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("[TanChat] Supabase SDK was not loaded.");
    alert("Supabase SDK could not be loaded.");
    return;
  }

  const AUTH_FUNCTION_URL =
    `${SUPABASE_URL}/functions/v1/username-auth`;

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    }
  );

  // ========================================
  // DOM elements
  // ========================================

  const $ = (id) => document.getElementById(id);

  const authView = $("authView");
  const chatView = $("chatView");
  const authForm = $("authForm");
  const usernameInput = $("username");
  const passwordInput = $("password");
  const authMessage = $("authMessage");

  const registerBtn = $("registerBtn");
  const loginBtn = $("loginBtn");

  const logoutBtn = $("logoutBtn");
  const currentUsername = $("currentUsername");

  const messagesContainer = $("messages");
  const messageForm = $("messageForm");
  const messageInput = $("messageInput");

  const requiredElements = {
    authView,
    chatView,
    authForm,
    usernameInput,
    passwordInput,
    logoutBtn,
    messagesContainer,
    messageForm,
    messageInput
  };

  const missingElements = Object.entries(requiredElements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length > 0) {
    console.error(
      "[TanChat] Missing HTML elements:",
      missingElements.join(", ")
    );
    alert("Some TanChat HTML elements are missing. Check index.html.");
    return;
  }

  // ========================================
  // State
  // ========================================

  let currentUser = null;
  let channel = null;
  let authRequestRunning = false;
  let isSending = false;
  let isLoadingMessages = false;
  let sessionVersion = 0;

  const renderedMessageIds = new Set();

  // ========================================
  // UI helpers
  // ========================================

  function showAuthMessage(message, isError = false) {
    if (!authMessage) {
      if (message) console.log("[TanChat]", message);
      return;
    }

    authMessage.textContent = message;
    authMessage.style.color = isError ? "#ff6b81" : "#ff8bc2";
  }

  function setAuthButtonsDisabled(disabled) {
    if (registerBtn) registerBtn.disabled = disabled;
    if (loginBtn) loginBtn.disabled = disabled;

    usernameInput.disabled = disabled;
    passwordInput.disabled = disabled;
  }

  function showAuthView() {
    authView.hidden = false;
    chatView.hidden = true;
  }

  function showChatView() {
    authView.hidden = true;
    chatView.hidden = false;
  }

  function normalizeUsername(value) {
    return value.trim().toLowerCase();
  }

  function isValidUsername(username) {
    return /^[a-z0-9_]{3,20}$/.test(username);
  }

  function getUsernameFromUser(user) {
    const metadataUsername = user?.user_metadata?.username;

    if (
      typeof metadataUsername === "string" &&
      metadataUsername.trim()
    ) {
      return normalizeUsername(metadataUsername);
    }

    return user?.email?.split("@")[0] || "Player";
  }

  function getAuthErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();

    if (
      message.includes("incorrect username or password") ||
      message.includes("invalid login credentials") ||
      message.includes("invalid_credentials")
    ) {
      return "Incorrect username or password.";
    }

    if (
      message.includes("already registered") ||
      message.includes("already been registered") ||
      message.includes("username may already be taken")
    ) {
      return "This username may already be taken.";
    }

    if (message.includes("username must")) {
      return "Username must be 3-20 letters, numbers, or underscores.";
    }

    if (message.includes("password must")) {
      return "Password must be 10-128 characters.";
    }

    if (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("network request failed")
    ) {
      return "Connection failed. Check your internet connection.";
    }

    if (message.includes("server configuration error")) {
      return "Server configuration error. Check the Edge Function settings.";
    }

    return error?.message || "An unexpected error occurred.";
  }

  // ========================================
  // Username authentication
  // ========================================

  async function authenticateWithUsername(
    action,
    username,
    password
  ) {
    const normalizedUsername = normalizeUsername(username);

    if (!isValidUsername(normalizedUsername)) {
      throw new Error(
        "Username must be 3-20 letters, numbers, or underscores."
      );
    }

    if (password.length < 10 || password.length > 128) {
      throw new Error("Password must be 10-128 characters.");
    }

    const response = await fetch(AUTH_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        action,
        username: normalizedUsername,
        password
      })
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error(
        "The authentication server returned an invalid response."
      );
    }

    if (!response.ok) {
      throw new Error(
        result?.error || `Authentication failed (${response.status}).`
      );
    }

    if (
      !result?.session?.access_token ||
      !result?.session?.refresh_token
    ) {
      throw new Error("The server did not return a valid session.");
    }

    // Store the returned session using the Supabase client.
    const { data, error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token
    });

    if (error) throw error;

    if (!data.session) {
      throw new Error("Could not save the login session.");
    }

    return data;
  }

  async function handleAuthSubmit(action) {
    if (authRequestRunning) return;

    const username = usernameInput.value;
    const password = passwordInput.value;

    authRequestRunning = true;
    setAuthButtonsDisabled(true);

    try {
      showAuthMessage(
        action === "register"
          ? "Creating your account..."
          : "Logging in..."
      );

      await authenticateWithUsername(
        action,
        username,
        password
      );

      passwordInput.value = "";

      showAuthMessage(
        action === "register"
          ? "Account created successfully!"
          : "Login successful!"
      );
    } catch (error) {
      console.error("[TanChat] Authentication error:", error);
      showAuthMessage(getAuthErrorMessage(error), true);
    } finally {
      authRequestRunning = false;
      setAuthButtonsDisabled(false);
    }
  }

  // Use the actual submit button, including keyboard submission.
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitterId = event.submitter?.id;

    let action = "login";

    if (submitterId === "registerBtn") {
      action = "register";
    } else if (submitterId === "loginBtn") {
      action = "login";
    }

    await handleAuthSubmit(action);
  });

  // ========================================
  // Chat messages
  // ========================================

  function renderMessage(message) {
    if (!message || message.id == null) return;

    const messageId = String(message.id);

    if (renderedMessageIds.has(messageId)) return;
    renderedMessageIds.add(messageId);

    const messageElement = document.createElement("article");
    messageElement.className = "message";
    messageElement.dataset.messageId = messageId;

    const header = document.createElement("div");
    header.className = "message-header";

    const usernameElement = document.createElement("span");
    usernameElement.className = "message-username";
    usernameElement.textContent = message.username || "Player";

    const timeElement = document.createElement("time");
    timeElement.className = "message-time";

    const date = new Date(message.created_at);

    if (!Number.isNaN(date.getTime())) {
      timeElement.dateTime = date.toISOString();
      timeElement.textContent = date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    const bodyElement = document.createElement("p");
    bodyElement.className = "message-body";
    bodyElement.textContent = message.body || "";

    header.append(usernameElement, timeElement);
    messageElement.append(header, bodyElement);
    messagesContainer.appendChild(messageElement);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function loadMessages() {
    if (isLoadingMessages || !currentUser) return;

    isLoadingMessages = true;
    const loadingUserId = currentUser.id;

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, username, body, created_at")
        .order("id", { ascending: false })
        .limit(100);

      if (error) throw error;

      if (!currentUser || currentUser.id !== loadingUserId) return;

      messagesContainer.replaceChildren();
      renderedMessageIds.clear();

      // Display oldest to newest.
      for (const message of (data || []).reverse()) {
        renderMessage(message);
      }
    } catch (error) {
      console.error("[TanChat] Failed to load messages:", error);

      if (currentUser?.id === loadingUserId) {
        showAuthMessage(
          "Could not load messages. Check your Supabase RLS policies.",
          true
        );
      }
    } finally {
      isLoadingMessages = false;
    }
  }

  // ========================================
  // Supabase Realtime
  // ========================================

  function unsubscribeFromMessages() {
    if (channel) {
      void supabase.removeChannel(channel);
      channel = null;
    }
  }

  function subscribeToMessages() {
    unsubscribeFromMessages();

    channel = supabase
      .channel("tanchat-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          if (!currentUser) return;
          renderMessage(payload.new);
        }
      )
      .subscribe((status) => {
        console.log("[TanChat] Realtime status:", status);

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(
            "[TanChat] Realtime subscription failed. Check Supabase settings."
          );
        }
      });
  }

  // ========================================
  // Send a message
  // ========================================

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser || isSending) return;

    const body = messageInput.value.trim();

    if (!body) return;

    if (body.length > 2000) {
      alert("Messages cannot exceed 2000 characters.");
      return;
    }

    isSending = true;
    messageInput.disabled = true;

    try {
      const username = getUsernameFromUser(currentUser);

      const { error } = await supabase
        .from("messages")
        .insert({
          user_id: currentUser.id,
          username,
          body
        });

      if (error) throw error;

      messageInput.value = "";
    } catch (error) {
      console.error("[TanChat] Failed to send message:", error);
      alert(
        "Message could not be sent. Check your connection and Supabase permissions."
      );
    } finally {
      isSending = false;
      messageInput.disabled = false;

      if (currentUser) messageInput.focus();
    }
  });

  // ========================================
  // Logout
  // ========================================

  logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;

    try {
      const { error } = await supabase.auth.signOut();

      if (error) throw error;
    } catch (error) {
      console.error("[TanChat] Logout error:", error);
      alert("Could not log out. Please try again.");
    } finally {
      logoutBtn.disabled = false;
    }
  });

  // ========================================
  // Session / automatic login
  // ========================================

  async function applySession(session, version) {
    if (version !== sessionVersion) return;

    if (!session?.user) {
      currentUser = null;

      unsubscribeFromMessages();
      renderedMessageIds.clear();
      messagesContainer.replaceChildren();

      showAuthView();
      showAuthMessage("");
      return;
    }

    currentUser = session.user;

    if (currentUsername) {
      currentUsername.textContent = getUsernameFromUser(currentUser);
    }

    showChatView();

    await loadMessages();

    if (
      version !== sessionVersion ||
      !currentUser ||
      currentUser.id !== session.user.id
    ) {
      return;
    }

    subscribeToMessages();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[TanChat] Auth state:", event);

    const version = ++sessionVersion;

    // Defer further Supabase operations outside the callback.
    setTimeout(() => {
      applySession(session, version).catch((error) => {
        console.error("[TanChat] Session error:", error);
      });
    }, 0);
  });

  async function initialize() {
    showAuthView();

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.error("[TanChat] Failed to restore session:", error);
      showAuthMessage("Could not restore your session.", true);
      return;
    }

    await applySession(data.session, sessionVersion);
  }

  initialize().catch((error) => {
    console.error("[TanChat] Initialization error:", error);
    showAuthMessage("TanChat could not be initialized.", true);
  });
})();
