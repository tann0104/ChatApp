
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const authScreen = $("auth-screen");
  const chatScreen = $("chat-screen");
  const authForm = $("auth-form");
  const emailInput = $("email");
  const passwordInput = $("password");
  const usernameInput = $("username");
  const loginButton = $("login-button");
  const signupButton = $("signup-button");
  const authStatus = $("auth-status");

  const currentUserLabel = $("current-user");
  const userAvatar = $("user-avatar");
  const logoutButton = $("logout-button");
  const messagesElement = $("messages");
  const messageForm = $("message-form");
  const messageInput = $("message-input");
  const sendButton = $("send-button");
  const chatStatus = $("chat-status");
  const connectionStatus = $("connection-status");
  const connectionDot = document.querySelector(".connection-dot");

  const MAX_MESSAGE_LENGTH = 2000;
  const MAX_USERNAME_LENGTH = 32;
  const HISTORY_LIMIT = 100;

  let supabase = null;
  let currentUser = null;
  let chatChannel = null;
  let authRequestInProgress = false;
  let sendInProgress = false;
  let chatGeneration = 0;

  // Keep message IDs to prevent duplicate rendering.
  const renderedMessageIds = new Set();

  function setText(element, message) {
    element.textContent = message;
  }

  function setConnectionStatus(message, state = "offline") {
    setText(connectionStatus, message);
    connectionDot.classList.toggle("connected", state === "online");
    connectionDot.classList.toggle("disconnected", state === "offline");
  }

  function getDisplayName(user) {
    const metadataName = user.user_metadata?.username;

    if (typeof metadataName === "string" && metadataName.trim()) {
      return metadataName.trim().slice(0, MAX_USERNAME_LENGTH);
    }

    return user.email?.split("@")[0] || "User";
  }

  function showAuth(status = "") {
    authScreen.hidden = false;
    chatScreen.hidden = true;
    setText(authStatus, status);
  }

  function clearMessages() {
    messagesElement.replaceChildren();
    renderedMessageIds.clear();

    const emptyState = document.createElement("div");
    emptyState.id = "empty-state";
    emptyState.className = "empty-state";

    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "#";

    const title = document.createElement("h2");
    title.textContent = "Welcome to #general";

    const description = document.createElement("p");
    description.textContent = "This is the beginning of your community.";

    emptyState.append(icon, title, description);
    messagesElement.appendChild(emptyState);
  }

  function renderMessage(message) {
    if (!message || message.id == null) return;

    const id = String(message.id);

    if (renderedMessageIds.has(id)) return;

    renderedMessageIds.add(id);

    const emptyState = $("empty-state");
    if (emptyState) emptyState.remove();

    const article = document.createElement("article");
    article.className = "message";
    article.dataset.messageId = id;

    const avatar = document.createElement("div");
    avatar.className = "message-avatar";

    const name = String(message.username || "User")
      .trim()
      .slice(0, MAX_USERNAME_LENGTH) || "User";

    avatar.textContent = name.charAt(0).toUpperCase();
    avatar.setAttribute("aria-hidden", "true");

    const content = document.createElement("div");
    content.className = "message-content";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const author = document.createElement("strong");
    author.textContent = name;

    const time = document.createElement("time");
    const date = new Date(message.created_at);

    if (!Number.isNaN(date.getTime())) {
      time.dateTime = date.toISOString();
      time.textContent = date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } else {
      time.textContent = "";
    }

    const body = document.createElement("p");
    body.textContent = String(message.body ?? "");

    meta.append(author, time);
    content.append(meta, body);
    article.append(avatar, content);
    messagesElement.appendChild(article);

    // Keep the newest message visible.
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  async function loadHistory(generation) {
    const { data, error } = await supabase
      .from("messages")
      .select("id, user_id, username, body, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (generation !== chatGeneration) return;

    if (error) {
      console.error("History loading failed:", error);
      setText(chatStatus, "Could not load message history.");
      return;
    }

    // Oldest first, newest last.
    for (const message of (data || []).reverse()) {
      renderMessage(message);
    }

    if (data?.length) {
      messagesElement.scrollTop = messagesElement.scrollHeight;
    }
  }

  function stopRealtime() {
    if (chatChannel && supabase) {
      supabase.removeChannel(chatChannel);
      chatChannel = null;
    }
  }

  async function startRealtime(generation) {
    stopRealtime();

    chatChannel = supabase
      .channel("tanchat-global-messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          if (generation !== chatGeneration) return;
          renderMessage(payload.new);
        }
      )
      .subscribe((status) => {
        if (generation !== chatGeneration) return;

        if (status === "SUBSCRIBED") {
          setConnectionStatus("Connected", "online");
          setText(chatStatus, "");
        } else if (status === "CHANNEL_ERROR") {
          setConnectionStatus("Connection error");
          setText(chatStatus, "Realtime connection failed. Check Supabase settings.");
          console.error("Supabase Realtime channel error");
        } else if (status === "TIMED_OUT") {
          setConnectionStatus("Connection timed out");
        } else if (status === "CLOSED") {
          setConnectionStatus("Disconnected");
        }
      });
  }

  async function enterChat(user) {
    if (!user || !supabase) return;

    // Invalidate pending operations from the previous session.
    const generation = ++chatGeneration;
    stopRealtime();

    currentUser = user;

    const displayName = getDisplayName(user);
    setText(currentUserLabel, displayName);
    setText(userAvatar, displayName.charAt(0).toUpperCase());

    authScreen.hidden = true;
    chatScreen.hidden = false;
    setText(chatStatus, "Loading messages...");
    setConnectionStatus("Connecting...");
    clearMessages();

    // Subscribe first so new messages are not missed while loading history.
    await startRealtime(generation);

    if (generation !== chatGeneration) return;
    await loadHistory(generation);

    if (generation === chatGeneration) {
      messageInput.focus();
    }
  }

  async function leaveChat() {
    ++chatGeneration;
    stopRealtime();

    currentUser = null;
    sendInProgress = false;
    sendButton.disabled = false;
    messageInput.value = "";

    clearMessages();
    setConnectionStatus("Disconnected");
    setText(chatStatus, "");

    showAuth();
  }

  async function handleAuthChange(session) {
    if (session?.user) {
      await enterChat(session.user);
    } else {
      await leaveChat();
    }
  }

  async function runAuth(action) {
    if (!supabase || authRequestInProgress) return;

    authRequestInProgress = true;
    loginButton.disabled = true;
    signupButton.disabled = true;

    try {
      const email = emailInput.value.trim();
      const password = passwordInput.value;

      if (!email || !password) {
        setText(authStatus, "Enter your email and password.");
        return;
      }

      if (password.length < 8) {
        setText(authStatus, "Password must be at least 8 characters.");
        return;
      }

      setText(authStatus, "Please wait...");

      if (action === "signup") {
        const username = usernameInput.value.trim();

        if (!username || username.length > MAX_USERNAME_LENGTH) {
          setText(authStatus, "Enter a display name (1–32 characters).");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { username }
          }
        });

        if (error) throw error;

        if (data.session) {
          setText(authStatus, "Account created successfully.");
          // Auth state listener will enter the chat.
        } else {
          setText(
            authStatus,
            "Account created. Check your email to confirm your account."
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;
        setText(authStatus, "Login successful.");
      }
    } catch (error) {
      console.error("Authentication error:", error);
      setText(authStatus, error.message || "Authentication failed.");
    } finally {
      authRequestInProgress = false;
      loginButton.disabled = false;
      signupButton.disabled = false;
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    if (!supabase || !currentUser || sendInProgress) return;

    const body = messageInput.value.trim();

    if (!body) {
      setText(chatStatus, "Message cannot be empty.");
      return;
    }

    if (body.length > MAX_MESSAGE_LENGTH) {
      setText(chatStatus, "Message is too long.");
      return;
    }

    sendInProgress = true;
    sendButton.disabled = true;
    setText(chatStatus, "Sending...");

    try {
      const user = currentUser;
      const generation = chatGeneration;

      const { error } = await supabase
        .from("messages")
        .insert({
          user_id: user.id,
          username: getDisplayName(user),
          body
        });

      if (error) throw error;

      // Do not overwrite the draft if the user has switched accounts.
      if (generation === chatGeneration && currentUser?.id === user.id) {
        messageInput.value = "";
        setText(chatStatus, "");
        messageInput.focus();
      }
    } catch (error) {
      console.error("Message send failed:", error);
      setText(chatStatus, "Could not send message. Please try again.");
    } finally {
      sendInProgress = false;
      sendButton.disabled = false;
    }
  }

  async function logout() {
    if (!supabase) return;

    logoutButton.disabled = true;

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error("Logout failed:", error);
      setText(chatStatus, "Could not log out. Please try again.");
    } finally {
      logoutButton.disabled = false;
    }
  }

  function initialize() {
    if (!window.supabase?.createClient) {
      showAuth("Could not load Supabase SDK. Check your internet connection.");
      return;
    }

    const url = window.SUPABASE_URL;
    const key = window.SUPABASE_KEY;

    if (
      !url ||
      !key ||
      url.includes("YOUR_PROJECT") ||
      key.includes("YOUR_PUBLISHABLE_KEY")
    ) {
      showAuth("Set your Supabase URL and publishable key in config.js.");
      return;
    }

    try {
      supabase = window.supabase.createClient(url, key);
    } catch (error) {
      console.error("Supabase initialization failed:", error);
      showAuth("Could not initialize Supabase. Check config.js.");
      return;
    }

    authForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runAuth("login");
    });

    signupButton.addEventListener("click", () => {
      runAuth("signup");
    });

    messageForm.addEventListener("submit", sendMessage);
    logoutButton.addEventListener("click", logout);

    // Supabase emits the initial session and subsequent auth changes.
    supabase.auth.onAuthStateChange((_event, session) => {
      // Defer async work outside the auth callback.
      setTimeout(() => {
        handleAuthChange(session).catch((error) => {
          console.error("Session handling failed:", error);
          showAuth("Could not load your session. Please try again.");
        });
      }, 0);
    });

    showAuth();
  }

  initialize();
})();
