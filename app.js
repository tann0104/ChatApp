
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

  const $ = (id) => document.getElementById(id);

  // ========================================
  // DOM
  // ========================================

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
  const currentAvatar = $("currentAvatar");

  const messagesContainer = $("messages");
  const messageForm = $("messageForm");
  const messageInput = $("messageInput");
  const sendButton = $("sendButton");

  const channelSidebar = $("channelSidebar");
  const memberSidebar = $("memberSidebar");
  const sidebarBackdrop = $("sidebarBackdrop");
  const mobileChannelsBtn = $("mobileChannelsBtn");
  const mobileMembersBtn = $("mobileMembersBtn");

  const connectionDot = $("connectionDot");
  const connectionLabel = $("connectionLabel");
  const headerOnlineCount = $("headerOnlineCount");
  const memberCountBadge = $("memberCountBadge");
  const memberList = $("memberList");

  const replyPreview = $("replyPreview");
  const replyToUsername = $("replyToUsername");
  const replyToBody = $("replyToBody");
  const cancelReplyBtn = $("cancelReplyBtn");

  const emojiButton = $("emojiButton");
  const mentionButton = $("mentionButton");
  const chatStatus = $("chatStatus");

  const requiredElements = {
    authView,
    chatView,
    authForm,
    usernameInput,
    passwordInput,
    messagesContainer,
    messageForm,
    messageInput,
    logoutBtn,
    memberList
  };

  const missingElements = Object.entries(requiredElements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length) {
    console.error("[TanChat] Missing HTML elements:", missingElements);
    alert("Some TanChat HTML elements are missing. Check index.html.");
    return;
  }

  // ========================================
  // State
  // ========================================

  let currentUser = null;
  let messageChannel = null;
  let authRequestRunning = false;
  let isSending = false;
  let isLoadingMessages = false;
  let sessionVersion = 0;
  let realtimeConnected = false;
  let currentReply = null;
  let chatStatusTimer = null;

  const renderedMessageIds = new Set();

  // Reactions are temporary and local to this browser session.
  const localReactions = new Map();

  const EMOJIS = ["😀", "😂", "🥹", "😍", "👍", "❤️", "🎉", "🔥", "✨", "👀"];

  // ========================================
  // Helpers
  // ========================================

  function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
  }

  function isValidUsername(username) {
    return /^[a-z0-9_]{3,20}$/.test(username);
  }

  function getUsernameFromUser(user) {
    const name = user?.user_metadata?.username;

    if (typeof name === "string" && name.trim()) {
      return normalizeUsername(name);
    }

    return user?.email?.split("@")[0] || "Player";
  }

  function getInitial(name) {
    const value = String(name || "T").trim();
    return Array.from(value)[0]?.toUpperCase() || "T";
  }

  function showAuthMessage(message, isError = false) {
    if (!authMessage) return;

    authMessage.textContent = message;
    authMessage.style.color = isError ? "#ff777f" : "#ff8bc7";
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
    closeSidebars();
  }

  function showChatView() {
    authView.hidden = true;
    chatView.hidden = false;
  }

  function setChatStatus(message, isError = false) {
    if (!chatStatus) return;

    if (chatStatusTimer) {
      clearTimeout(chatStatusTimer);
      chatStatusTimer = null;
    }

    chatStatus.textContent = message;
    chatStatus.style.color = isError ? "#ff777f" : "#929098";

    if (message) {
      chatStatusTimer = setTimeout(() => {
        chatStatus.textContent =
          "ENTER 送信 · SHIFT + ENTER 改行";
        chatStatus.style.color = "";
        chatStatusTimer = null;
      }, 3500);
    }
  }

  function getAuthErrorMessage(error) {
    const message = String(error?.message || "").toLowerCase();

    if (
      message.includes("invalid login credentials") ||
      message.includes("incorrect username or password") ||
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
  // Authentication
  // ========================================

  async function authenticateWithUsername(action, username, password) {
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
      throw new Error("The authentication server returned an invalid response.");
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

    const { data, error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token
    });

    if (error) throw error;
    if (!data.session) throw new Error("Could not save the login session.");

    return data;
  }

  async function handleAuthSubmit(action) {
    if (authRequestRunning) return;

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
        usernameInput.value,
        passwordInput.value
      );

      passwordInput.value = "";
    } catch (error) {
      console.error("[TanChat] Authentication error:", error);
      showAuthMessage(getAuthErrorMessage(error), true);
    } finally {
      authRequestRunning = false;
      setAuthButtonsDisabled(false);
    }
  }

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitterId = event.submitter?.id;
    const action = submitterId === "registerBtn" ? "register" : "login";

    await handleAuthSubmit(action);
  });

  // ========================================
  // Dates and message formatting
  // ========================================

  function getDateKey(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "unknown";

    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatDateLabel(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "Date unknown";

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (getDateKey(date) === getDateKey(today)) return "今日";
    if (getDateKey(date) === getDateKey(yesterday)) return "昨日";

    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  }

  function formatTime(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function appendMentionText(parent, text) {
    const parts = String(text || "").split(/(@[a-z0-9_]{3,20})/gi);

    for (const part of parts) {
      if (/^@[a-z0-9_]{3,20}$/i.test(part)) {
        const mention = document.createElement("span");
        mention.className = "mention";
        mention.textContent = part;
        parent.appendChild(mention);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);

    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;

    return element;
  }

  function appendDateDivider(dateValue) {
    const divider = makeElement("div", "date-divider");
    divider.dataset.dateKey = getDateKey(dateValue);
    divider.textContent = formatDateLabel(dateValue);
    messagesContainer.appendChild(divider);
  }

  function parseReplyBody(body) {
    const match = String(body || "").match(
      /^↪ @([a-z0-9_]{3,20}): ([^\n]*)\n\n([\s\S]*)$/i
    );

    if (!match) return null;

    return {
      username: match[1],
      excerpt: match[2],
      body: match[3]
    };
  }

  function addReplyQuote(parent, reply) {
    if (!reply) return;

    const quote = makeElement("div", "reply-quote");
    const username = makeElement("strong", "", `@${reply.username}`);
    const excerpt = makeElement("span", "", reply.excerpt);

    quote.append(username, excerpt);
    parent.appendChild(quote);
  }

  // ========================================
  // Reactions
  // ========================================

  function getReactionsForMessage(messageId) {
    if (!localReactions.has(messageId)) {
      localReactions.set(messageId, new Map());
    }

    return localReactions.get(messageId);
  }

  function renderReactions(messageId, container) {
    container.replaceChildren();

    const reactions = getReactionsForMessage(messageId);

    for (const [emoji, selected] of reactions) {
      if (!selected) continue;

      const button = makeElement("button", "reaction-button active", emoji);
      button.type = "button";
      button.title = "このブラウザ内のリアクション（未共有）";
      button.setAttribute("aria-label", `${emoji} リアクションを解除`);

      button.addEventListener("click", () => {
        reactions.delete(emoji);
        renderReactions(messageId, container);
      });

      container.appendChild(button);
    }

    const addButton = makeElement("button", "reaction-button reaction-add", "+");
    addButton.type = "button";
    addButton.title = "リアクションを追加";
    addButton.setAttribute("aria-label", "リアクションを追加");

    addButton.addEventListener("click", () => {
      showReactionPicker(addButton, (emoji) => {
        reactions.set(emoji, true);
        renderReactions(messageId, container);
      });
    });

    container.appendChild(addButton);
  }

  function showReactionPicker(anchor, onSelect) {
    const existing = document.getElementById("reactionPicker");

    if (existing) existing.remove();

    const picker = makeElement("div", "");
    picker.id = "reactionPicker";

    Object.assign(picker.style, {
      position: "fixed",
      zIndex: "1000",
      display: "flex",
      flexWrap: "wrap",
      gap: "4px",
      padding: "8px",
      maxWidth: "220px",
      border: "1px solid #3b303b",
      borderRadius: "12px",
      background: "#1d1d20",
      boxShadow: "0 10px 35px rgba(0,0,0,.4)"
    });

    for (const emoji of EMOJIS) {
      const button = makeElement("button", "", emoji);
      button.type = "button";

      Object.assign(button.style, {
        width: "31px",
        height: "31px",
        border: "0",
        borderRadius: "7px",
        background: "transparent",
        fontSize: "17px"
      });

      button.addEventListener("click", () => {
        onSelect(emoji);
        picker.remove();
      });

      picker.appendChild(button);
    }

    document.body.appendChild(picker);

    const rect = anchor.getBoundingClientRect();
    const pickerRect = picker.getBoundingClientRect();

    picker.style.left = `${Math.max(
      8,
      Math.min(rect.left, window.innerWidth - pickerRect.width - 8)
    )}px`;

    picker.style.top = `${Math.max(
      8,
      Math.min(rect.bottom + 5, window.innerHeight - pickerRect.height - 8)
    )}px`;

    const closeOnOutsideClick = (event) => {
      if (!picker.contains(event.target) && event.target !== anchor) {
        picker.remove();
        document.removeEventListener("click", closeOnOutsideClick, true);
      }
    };

    setTimeout(() => {
      document.addEventListener("click", closeOnOutsideClick, true);
    }, 0);
  }

  // ========================================
  // Render a message
  // ========================================

  function renderMessage(message) {
    if (!message || message.id == null) return;

    const messageId = String(message.id);

    if (renderedMessageIds.has(messageId)) return;

    renderedMessageIds.add(messageId);

    const welcome = messagesContainer.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    const dateKey = getDateKey(message.created_at);
    const lastDivider = messagesContainer.querySelector(".date-divider:last-of-type");

    if (!lastDivider || lastDivider.dataset.dateKey !== dateKey) {
      appendDateDivider(message.created_at);
    }

    const username = message.username || "Player";
    const messageElement = makeElement("article", "message");
    messageElement.dataset.messageId = messageId;

    const avatar = makeElement("div", "message-avatar", getInitial(username));
    avatar.setAttribute("aria-label", `${username} のアイコン`);

    const content = makeElement("div", "message-content");
    const meta = makeElement("div", "message-meta");

    const usernameElement = makeElement("strong", "message-username", username);
    const timeElement = makeElement("time", "message-time");

    const date = new Date(message.created_at);

    if (!Number.isNaN(date.getTime())) {
      timeElement.dateTime = date.toISOString();
      timeElement.textContent = formatTime(message.created_at);
      timeElement.title = date.toLocaleString();
    }

    meta.append(usernameElement, timeElement);
    content.appendChild(meta);

    const reply = parseReplyBody(message.body);

    if (reply) {
      addReplyQuote(content, reply);
    }

    const bodyElement = makeElement("p", "message-body");
    appendMentionText(bodyElement, reply ? reply.body : message.body);
    content.appendChild(bodyElement);

    const actions = makeElement("div", "message-actions");

    const replyButton = makeElement("button", "message-action", "↩ 返信");
    replyButton.type = "button";

    replyButton.addEventListener("click", () => {
      currentReply = {
        id: messageId,
        username,
        body: String(message.body || "").slice(0, 180)
      };

      replyToUsername.textContent = username;
      replyToBody.textContent = String(message.body || "").slice(0, 100);
      replyPreview.hidden = false;
      messageInput.focus();
    });

    const reactionButton = makeElement("button", "message-action", "☺ リアクション");
    reactionButton.type = "button";

    actions.append(replyButton, reactionButton);
    content.appendChild(actions);

    const reactionList = makeElement("div", "reaction-list");

    reactionButton.addEventListener("click", () => {
      showReactionPicker(reactionButton, (emoji) => {
        getReactionsForMessage(messageId).set(emoji, true);
        renderReactions(messageId, reactionList);
      });
    });

    renderReactions(messageId, reactionList);
    content.appendChild(reactionList);

    messageElement.append(avatar, content);
    messagesContainer.appendChild(messageElement);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // ========================================
  // Load message history
  // ========================================

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

      localReactions.clear();

      for (const message of (data || []).reverse()) {
        renderMessage(message);
      }

      if (!data?.length) {
        const welcome = makeElement("div", "welcome-message");
        const icon = makeElement("div", "welcome-icon", "#");
        const eyebrow = makeElement("p", "eyebrow", "THE BEGINNING");
        const heading = makeElement("h2", "", "Welcome to #general");
        const description = makeElement("p", "", "ここから会話を始めよう。");

        welcome.append(icon, eyebrow, heading, description);
        messagesContainer.appendChild(welcome);
      }
    } catch (error) {
      console.error("[TanChat] Failed to load messages:", error);

      if (currentUser?.id === loadingUserId) {
        setChatStatus(
          "履歴を読み込めません。Supabase の RLS 設定を確認してください。",
          true
        );
      }
    } finally {
      isLoadingMessages = false;
    }
  }

  // ========================================
  // Online members / Presence
  // ========================================

  function setConnectionStatus(connected, label) {
    realtimeConnected = connected;

    if (connectionDot) {
      connectionDot.classList.toggle("connected", connected);
      connectionDot.classList.toggle("disconnected", !connected);
    }

    if (connectionLabel) {
      connectionLabel.textContent = label;
    }
  }

  function renderMembers() {
    if (!memberList) return;

    const onlineUsers = new Map();

    if (currentUser) {
      const username = getUsernameFromUser(currentUser);

      onlineUsers.set(currentUser.id, {
        id: currentUser.id,
        username
      });
    }

    if (messageChannel) {
      const presenceState = messageChannel.presenceState();

      for (const [key, presences] of Object.entries(presenceState)) {
        for (const presence of presences) {
          const id = presence.user_id || key;
          const username = presence.username || "Player";

          if (id) {
            onlineUsers.set(id, { id, username });
          }
        }
      }
    }

    const users = Array.from(onlineUsers.values()).sort((a, b) => {
      const selfId = currentUser?.id;

      if (a.id === selfId) return -1;
      if (b.id === selfId) return 1;

      return a.username.localeCompare(b.username);
    });

    memberList.replaceChildren();

    if (!users.length) {
      memberList.appendChild(
        makeElement("div", "member-empty", "オンラインメンバーはいません。")
      );
    }

    for (const user of users) {
      const row = makeElement("div", "member-row");
      const avatarWrap = makeElement("div", "member-avatar-wrap");
      const avatar = makeElement("div", "member-avatar", getInitial(user.username));
      const presence = makeElement("span", "member-presence");
      const info = makeElement("div", "member-info");
      const name = makeElement("span", "member-name", user.username);
      const state = makeElement(
        "span",
        "member-state",
        user.id === currentUser?.id ? "あなた · Online" : "Online"
      );

      avatarWrap.append(avatar, presence);
      info.append(name, state);
      row.append(avatarWrap, info);
      memberList.appendChild(row);
    }

    const count = users.length;

    if (memberCountBadge) memberCountBadge.textContent = String(count);
    if (headerOnlineCount) {
      headerOnlineCount.textContent = `${count} online`;
    }
  }

  function unsubscribeFromMessages() {
    if (messageChannel) {
      const oldChannel = messageChannel;
      messageChannel = null;
      void supabase.removeChannel(oldChannel);
    }

    setConnectionStatus(false, "Disconnected");

    if (memberList) memberList.replaceChildren();
    if (memberCountBadge) memberCountBadge.textContent = "0";
    if (headerOnlineCount) headerOnlineCount.textContent = "0 online";
  }

  function subscribeToMessages() {
    unsubscribeFromMessages();

    if (!currentUser) return;

    const subscribingUser = currentUser;

    messageChannel = supabase.channel("tanchat-messages", {
      config: {
        presence: {
          key: subscribingUser.id
        }
      }
    });

    messageChannel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          if (!currentUser || currentUser.id !== subscribingUser.id) return;
          renderMessage(payload.new);
        }
      )
      .on("presence", { event: "sync" }, () => {
        renderMembers();
      })
      .subscribe(async (status) => {
        if (!currentUser || currentUser.id !== subscribingUser.id) return;

        console.log("[TanChat] Realtime status:", status);

        if (status === "SUBSCRIBED") {
          setConnectionStatus(true, "Connected");

          const { error } = await messageChannel.track({
            user_id: subscribingUser.id,
            username: getUsernameFromUser(subscribingUser),
            online_at: new Date().toISOString()
          });

          if (error) {
            console.error("[TanChat] Presence tracking failed:", error);
          }

          renderMembers();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionStatus(false, "Connection issue");
        } else if (status === "CLOSED") {
          setConnectionStatus(false, "Disconnected");
        }
      });
  }

  // ========================================
  // Reply preview
  // ========================================

  function clearReply() {
    currentReply = null;

    if (replyPreview) replyPreview.hidden = true;
    if (replyToUsername) replyToUsername.textContent = "";
    if (replyToBody) replyToBody.textContent = "";
  }

  cancelReplyBtn?.addEventListener("click", clearReply);

  // ========================================
  // Send messages
  // ========================================

  async function sendMessage() {
    if (!currentUser || isSending) return;

    const typedBody = messageInput.value.trim();

    if (!typedBody) return;

    let body = typedBody;

    if (currentReply) {
      const excerpt = currentReply.body
        .replace(/\s+/g, " ")
        .slice(0, 120);

      const prefix = `↪ @${currentReply.username}: ${excerpt}\n\n`;
      body = prefix + typedBody;
    }

    if (body.length > 2000) {
      setChatStatus(
        "メッセージと返信引用を合わせて2000文字以内にしてください。",
        true
      );
      return;
    }

    isSending = true;
    messageInput.disabled = true;
    if (sendButton) sendButton.disabled = true;

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
      autoResizeTextarea();
      clearReply();
      setChatStatus("");
    } catch (error) {
      console.error("[TanChat] Failed to send message:", error);

      setChatStatus(
        "送信できませんでした。接続と Supabase の権限を確認してください。",
        true
      );
    } finally {
      isSending = false;
      messageInput.disabled = false;
      if (sendButton) sendButton.disabled = false;

      if (currentUser) messageInput.focus();
    }
  }

  messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendMessage();
  });

  messageInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      await sendMessage();
    }
  });

  function autoResizeTextarea() {
    messageInput.style.height = "auto";
    messageInput.style.height =
      `${Math.min(messageInput.scrollHeight, 150)}px`;
  }

  messageInput.addEventListener("input", autoResizeTextarea);

  // ========================================
  // Emoji / mention insertion
  // ========================================

  function insertAtCursor(text) {
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const value = messageInput.value;

    messageInput.value =
      value.slice(0, start) + text + value.slice(end);

    const nextPosition = start + text.length;

    messageInput.focus();
    messageInput.setSelectionRange(nextPosition, nextPosition);
    autoResizeTextarea();
  }

  emojiButton?.addEventListener("click", () => {
    showReactionPicker(emojiButton, (emoji) => {
      insertAtCursor(emoji);
    });
  });

  mentionButton?.addEventListener("click", () => {
    insertAtCursor("@");
  });

  // ========================================
  // Mobile sidebars
  // ========================================

  function closeSidebars() {
    chatView?.classList.remove("channels-open", "members-open");
  }

  mobileChannelsBtn?.addEventListener("click", () => {
    chatView.classList.remove("members-open");
    chatView.classList.toggle("channels-open");
  });

  mobileMembersBtn?.addEventListener("click", () => {
    chatView.classList.remove("channels-open");
    chatView.classList.toggle("members-open");
  });

  sidebarBackdrop?.addEventListener("click", closeSidebars);

  window.addEventListener("resize", () => {
    if (window.innerWidth > 680) closeSidebars();
  });

  // ========================================
  // Profile shortcut
  // ========================================

  $("profileButton")?.addEventListener("click", () => {
    if (!currentUser) return;

    setChatStatus(
      `ログイン中: ${getUsernameFromUser(currentUser)}`
    );
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
  // Session handling
  // ========================================

  async function applySession(session, version) {
    if (version !== sessionVersion) return;

    if (!session?.user) {
      currentUser = null;

      unsubscribeFromMessages();
      renderedMessageIds.clear();
      localReactions.clear();
      messagesContainer.replaceChildren();

      showAuthView();
      showAuthMessage("");
      clearReply();
      return;
    }

    currentUser = session.user;

    const username = getUsernameFromUser(currentUser);

    if (currentUsername) currentUsername.textContent = username;
    if (currentAvatar) currentAvatar.textContent = getInitial(username);

    showChatView();
    renderMembers();

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

    // Defer additional Supabase operations outside the callback.
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
