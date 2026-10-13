
(() => {
  "use strict";

  // ========================================
  // TanChat - Supabase Chat
  // ========================================

  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_KEY = window.SUPABASE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error(
      "[TanChat] Supabase URL or Publishable key is missing."
    );
    alert("TanChat configuration is missing. Please check config.js.");
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("[TanChat] Supabase SDK was not loaded.");
    return;
  }

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  // ========================================
  // DOM elements
  // These IDs must match index.html.
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
    alert(
      "TanChat HTML elements are missing. Check the IDs in index.html."
    );
    return;
  }

  // ========================================
  // State
  // ========================================

  let currentUser = null;
  let channel = null;
  let pendingAuthAction = "login";
  let isSending = false;
  let isLoadingMessages = false;
  let authRequestRunning = false;

  const renderedMessageIds = new Set();

  // ========================================
  // UI helpers
  // ========================================

  function showAuthMessage(message, isError = false) {
    if (!authMessage) {
      console.log("[TanChat]", message);
      return;
    }

    authMessage.textContent = message;
    authMessage.style.color = isError ? "#ff6b81" : "#ff8bc2";
  }

  function setAuthButtonsDisabled(disabled) {
    if (registerBtn) registerBtn.disabled = disabled;
    if (loginBtn) loginBtn.disabled = disabled;

    if (usernameInput) usernameInput.disabled = disabled;
    if (passwordInput) passwordInput.disabled = disabled;
  }

  function showAuthView() {
    authView.hidden = false;
    chatView.hidden = true;
  }

  function showChatView() {
    authView.hidden = true;
    chatView.hidden = false;
  }

  function setMessageStatus(message) {
    if (messageInput) {
      messageInput.placeholder = message;
    }
  }

  function normalizeUsername(value) {
    return value.trim().toLowerCase();
  }

  function isValidUsername(username) {
    return /^[a-z0-9_]{3,20}$/.test(username);
  }

  function usernameToInternalEmail(username) {
    // Internal identifier only; this is NOT a real email address.
    return `${normalizeUsername(username)}@users.tanchat.invalid`;
  }

  function getUsernameFromUser(user) {
    const metadataUsername = user?.user_metadata?.username;

    if (
      typeof metadataUsername === "string" &&
      metadataUsername.trim()
    ) {
      return normalizeUsername(metadataUsername);
    }

    // Fallback for older accounts.
    return user?.email?.split("@")[0] || "Player";
  }

  function getAuthErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();

    if (
      message.includes("invalid login credentials") ||
      message.includes("invalid_credentials")
    ) {
      return "Incorrect username or password.";
    }

    if (
      message.includes("user already registered") ||
      message.includes("already been registered")
    ) {
      return "This username is already registered.";
    }

    if (message.includes("password should be at least")) {
      return "Password must be at least 10 characters.";
    }

    if (
      message.includes("email not confirmed") ||
      message.includes("email_not_confirmed")
    ) {
      return (
        "Email confirmation is enabled in Supabase. " +
        "Review the Auth provider settings."
      );
    }

    if (
      message.includes("failed to fetch") ||
      message.includes("network")
    ) {
      return "Connection failed. Check your internet and Supabase settings.";
    }

    return error?.message || "An unexpected error occurred.";
  }

  // ========================================
  // Authentication
  // ========================================

  async function registerWithUsername(username, password) {
    const normalizedUsername = normalizeUsername(username);

    if (!isValidUsername(normalizedUsername)) {
      throw new Error(
        "Username must be 3-20 characters using letters, numbers, or underscores."
      );
    }

    if (password.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }

    const internalEmail =
      usernameToInternalEmail(normalizedUsername);

    const { data, error } = await supabase.auth.signUp({
      email: internalEmail,
      password,
      options: {
        data: {
          username: normalizedUsername
        }
      }
    });

    if (error) throw error;

    if (!data.session) {
      throw new Error(
        "Account created, but no session was returned. " +
        "Check Supabase email confirmation settings before trying again."
      );
    }

    return data;
  }

  async function loginWithUsername(username, password) {
    const normalizedUsername = normalizeUsername(username);

    if (!isValidUsername(normalizedUsername)) {
      throw new Error(
        "Enter a valid username (3-20 letters, numbers, or underscores)."
      );
    }

    if (!password) {
      throw new Error("Enter your password.");
    }

    const internalEmail =
      usernameToInternalEmail(normalizedUsername);

    const { data, error } =
      await supabase.auth.signInWithPassword({
        email: internalEmail,
        password
      });

    if (error) throw error;

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

      if (action === "register") {
        await registerWithUsername(username, password);
        showAuthMessage("Account created successfully!");
      } else {
        await loginWithUsername(username, password);
        showAuthMessage("Login successful!");
      }

      passwordInput.value = "";
    } catch (error) {
      console.error("[TanChat] Authentication error:", error);
      showAuthMessage(getAuthErrorMessage(error), true);
    } finally {
      authRequestRunning = false;
      setAuthButtonsDisabled(false);
    }
  }

  if (registerBtn) {
    registerBtn.addEventListener("click", () => {
      pendingAuthAction = "register";
    });
  }

  if (loginBtn) {
    loginBtn.addEventListener("click", () => {
      pendingAuthAction = "login";
    });
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleAuthSubmit(pendingAuthAction);
    pendingAuthAction = "login";
  });

  // ========================================
  // Chat messages
  // ========================================

  function renderMessage(message) {
    if (!message || message.id == null) return;

    const messageId = String(message.id);

    // Prevent duplicate messages from history and Realtime.
    if (renderedMessageIds.has(messageId)) return;

    renderedMessageIds.add(messageId);

    const messageElement = document.createElement("article");
    messageElement.className = "message";
    messageElement.dataset.messageId = messageId;

    const header = document.createElement("div");
    header.className = "message-header";

    const usernameElement = document.createElement("span");
    usernameElement.className = "message-username";

    // Never insert user-controlled text using innerHTML.
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

    // Keep the newest message visible.
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  async function loadMessages() {
    if (isLoadingMessages) return;

    isLoadingMessages = true;

    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, user_id, username, body, created_at")
        .order("id", { ascending: false })
        .limit(100);

      if (error) throw error;

      messagesContainer.replaceChildren();
      renderedMessageIds.clear();

      // Query newest first, render oldest first.
      for (const message of (data || []).reverse()) {
        renderMessage(message);
      }
    } catch (error) {
      console.error("[TanChat] Failed to load messages:", error);
      showAuthMessage(
        "Could not load messages. Check your Supabase RLS policies.",
        true
      );
    } finally {
      isLoadingMessages = false;
    }
  }

  // ========================================
  // Supabase Realtime
  // ========================================

  function unsubscribeFromMessages() {
    if (channel) {
      supabase.removeChannel(channel);
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

        if (status === "CHANNEL_ERROR") {
          console.error(
            "[TanChat] Realtime subscription failed. " +
            "Check whether messages is included in supabase_realtime."
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
      messageInput.focus();
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
  // Session handling / automatic login
  // ========================================

  async function applySession(session) {
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
      currentUsername.textContent =
        getUsernameFromUser(currentUser);
    }

    showChatView();

    await loadMessages();

    // The user might have logged out while messages were loading.
    if (!currentUser || currentUser.id !== session.user.id) {
      return;
    }

    subscribeToMessages();
  }

  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[TanChat] Auth state:", event);

    // Defer Supabase operations to avoid running them
    // inside the auth-state callback.
    setTimeout(() => {
      applySession(session).catch((error) => {
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

    await applySession(data.session);
  }

  initialize().catch((error) => {
    console.error("[TanChat] Initialization error:", error);
    showAuthMessage("TanChat could not be initialized.", true);
  });

})();
