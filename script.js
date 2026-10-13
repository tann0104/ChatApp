
/*
 * ことりば - Chat Application
 * Supabase Realtime + Online Member Presence
 *
 * Required:
 *   config.js
 *   window.SUPABASE_URL
 *   window.SUPABASE_KEY
 */

(() => {
    "use strict";

    const SUPABASE_URL = window.SUPABASE_URL;
    const SUPABASE_KEY = window.SUPABASE_KEY;

    if (!window.supabase) {
        console.error("Supabase JS library is not loaded.");
        return;
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error(
            "Supabase configuration is missing. Check config.js."
        );
        return;
    }

    const sb = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );

    const $ = (id) => document.getElementById(id);

    const state = {
        user: null,
        room: null,
        name: localStorage.getItem("kotoriba_name") || "",
        channel: null,
        messageChannel: null,
        messages: [],
        rooms: [],
        presence: {},
        joining: false,
        sending: false
    };

    const escapeHTML = (value) =>
        String(value ?? "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);

    const formatTime = (value) => {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";

        return date.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit"
        });
    };

    function setText(id, value) {
        const element = $(id);
        if (element) element.textContent = value;
    }

    function show(element) {
        if (element) element.hidden = false;
    }

    function hide(element) {
        if (element) element.hidden = true;
    }

    function setStatus(message, isError = false) {
        const status = $("statusMessage") || $("status");
        if (!status) return;

        status.textContent = message;
        status.dataset.state = isError ? "error" : "normal";
    }

    function getName() {
        const input = $("nameInput") || $("displayName");
        return (
            input?.value?.trim() ||
            state.name ||
            "Guest"
        ).slice(0, 24);
    }

    function saveName(name) {
        state.name = name;
        localStorage.setItem("kotoriba_name", name);
    }

    async function ensureAuth() {
        const { data, error } = await sb.auth.getSession();

        if (error) throw error;

        if (data.session?.user) {
            state.user = data.session.user;
            return state.user;
        }

        const { data: authData, error: authError } =
            await sb.auth.signInAnonymously();

        if (authError) throw authError;

        state.user = authData.user;
        return state.user;
    }

    function showLobby() {
        state.room = null;
        state.messages = [];
        state.presence = {};

        if (state.channel) {
            sb.removeChannel(state.channel);
            state.channel = null;
        }

        if (state.messageChannel) {
            sb.removeChannel(state.messageChannel);
            state.messageChannel = null;
        }

        hide($("chatScreen"));
        show($("lobbyScreen"));

        renderOnlineMembers();
        loadRooms();
    }

    function showChat() {
        show($("chatScreen"));
        hide($("lobbyScreen"));

        setText(
            "roomTitle",
            state.room?.name || "チャットルーム"
        );

        setText(
            "currentRoomName",
            state.room?.name || "チャットルーム"
        );
    }

    async function loadRooms() {
        const list = $("roomList") || $("roomsList");
        if (!list) return;

        list.innerHTML = "<p>ルームを読み込み中...</p>";

        const { data, error } = await sb
            .from("rooms")
            .select("*")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Failed to load rooms:", error);
            list.innerHTML =
                "<p>ルームを読み込めませんでした。</p>";
            return;
        }

        state.rooms = data || [];
        renderRooms();
    }

    function renderRooms() {
        const list = $("roomList") || $("roomsList");
        if (!list) return;

        if (!state.rooms.length) {
            list.innerHTML =
                "<p class='empty-message'>ルームがありません。新しく作成してみよう！</p>";
            return;
        }

        list.innerHTML = state.rooms.map((room) => {
            const roomName = escapeHTML(
                room.name || room.title || "名前のないルーム"
            );

            const locked = Boolean(
                room.password_hash ||
                room.has_password ||
                room.is_private
            );

            return `
                <button
                    type="button"
                    class="room-item"
                    data-room-id="${escapeHTML(room.id)}"
                >
                    <span class="room-item-name">${roomName}</span>
                    ${locked
                        ? '<span class="room-lock" aria-label="パスワード保護">🔒</span>'
                        : ""}
                </button>
            `;
        }).join("");

        list.querySelectorAll("[data-room-id]").forEach((button) => {
            button.addEventListener("click", () => {
                const room = state.rooms.find(
                    (item) =>
                        String(item.id) === button.dataset.roomId
                );

                if (room) openRoom(room);
            });
        });
    }

    async function createRoom() {
        const nameInput = $("newRoomName") || $("roomNameInput");
        const roomName = nameInput?.value?.trim();

        if (!roomName) {
            setStatus("ルーム名を入力してください。", true);
            return;
        }

        if (!state.user) {
            setStatus("ログイン処理中です。", true);
            return;
        }

        const passwordInput = $("newRoomPassword");
        const password = passwordInput?.value || "";

        setStatus("ルームを作成中...");

        /*
         * This calls the existing create_room RPC.
         * Adjust argument names if your database function
         * uses a different signature.
         */
        const { data, error } = await sb.rpc("create_room", {
            room_name: roomName,
            room_password: password || null
        });

        if (error) {
            console.error("Failed to create room:", error);
            setStatus(
                "ルームを作成できませんでした。設定を確認してください。",
                true
            );
            return;
        }

        let createdRoom = null;

        if (Array.isArray(data)) {
            createdRoom = data[0] || null;
        } else if (data && typeof data === "object") {
            createdRoom = data;
        }

        if (createdRoom?.room_id && !createdRoom.id) {
            createdRoom.id = createdRoom.room_id;
        }

        if (createdRoom?.id) {
            await openRoom(createdRoom);
        } else {
            await loadRooms();
            setStatus("ルームを作成しました。");
        }

        if (nameInput) nameInput.value = "";
        if (passwordInput) passwordInput.value = "";
    }

    async function openRoom(room) {
        if (!room?.id) {
            setStatus("ルーム情報が正しくありません。", true);
            return;
        }

        if (state.channel) {
            await sb.removeChannel(state.channel);
            state.channel = null;
        }

        if (state.messageChannel) {
            await sb.removeChannel(state.messageChannel);
            state.messageChannel = null;
        }

        state.room = room;
        state.messages = [];
        state.presence = {};

        showChat();

        const name = getName();
        saveName(name);

        await joinRoomRecord(room, name);
        await loadMessages(room.id);
        subscribeToRoom(room.id);

        renderOnlineMembers();
    }

    async function joinRoomRecord(room, name) {
        /*
         * Uses the existing join_room RPC.
         * If your original RPC has different parameter names,
         * keep the parameter names from your current project.
         */
        const { error } = await sb.rpc("join_room", {
            room_id: room.id,
            member_name: name
        });

        if (error) {
            /*
             * Presence can still display online members even if
             * this optional database membership call is blocked.
             */
            console.warn("join_room RPC:", error.message);
        }
    }

    async function loadMessages(roomId) {
        const feed = $("chatMessages") || $("messages");
        if (!feed) return;

        feed.innerHTML = "<p>メッセージを読み込み中...</p>";

        const { data, error } = await sb
            .from("chat_messages")
            .select("*")
            .eq("room_id", roomId)
            .order("created_at", { ascending: true });

        if (error) {
            console.error("Failed to load messages:", error);
            feed.innerHTML =
                "<p>メッセージを読み込めませんでした。</p>";
            return;
        }

        state.messages = data || [];
        renderMessages();
    }

    function renderMessages() {
        const feed = $("chatMessages") || $("messages");
        if (!feed) return;

        if (!state.messages.length) {
            feed.innerHTML =
                "<p class='empty-message'>まだメッセージがありません。最初のメッセージを送ろう！</p>";
            return;
        }

        feed.innerHTML = state.messages.map((message) => {
            const author = escapeHTML(
                message.member_name ||
                message.user_name ||
                message.username ||
                "Guest"
            );

            const content = escapeHTML(
                message.content ||
                message.message ||
                ""
            );

            const time = escapeHTML(
                formatTime(message.created_at)
            );

            const ownMessage =
                message.user_id &&
                state.user?.id &&
                message.user_id === state.user.id;

            return `
                <article class="message${ownMessage ? " own-message" : ""}">
                    <div class="message-header">
                        <span class="message-author">${author}</span>
                        <time class="message-time">${time}</time>
                    </div>
                    <div class="message-content">${content}</div>
                </article>
            `;
        }).join("");

        feed.scrollTop = feed.scrollHeight;
    }

    async function sendMessage() {
        if (state.sending) return;
        if (!state.room || !state.user) {
            setStatus("ルームに参加してください。", true);
            return;
        }

        const input = $("messageInput") || $("message");
        const content = input?.value?.trim();

        if (!content) return;

        state.sending = true;

        try {
            const { error } = await sb
                .from("chat_messages")
                .insert({
                    room_id: state.room.id,
                    user_id: state.user.id,
                    member_name: getName(),
                    content
                });

            if (error) throw error;

            input.value = "";
            input.focus();
        } catch (error) {
            console.error("Failed to send message:", error);
            setStatus(
                "メッセージを送信できませんでした。",
                true
            );
        } finally {
            state.sending = false;
        }
    }

    function subscribeToRoom(roomId) {
        /*
         * Presence is temporary realtime state.
         * It does not require an online-members database table.
         */
        const channel = sb.channel(`kotoriba-room-${roomId}`, {
            config: {
                presence: {
                    key: state.user.id
                }
            }
        });

        state.channel = channel;

        channel
            .on("presence", { event: "sync" }, () => {
                state.presence = channel.presenceState();
                renderOnlineMembers();
            })
            .on("presence", { event: "join" }, () => {
                state.presence = channel.presenceState();
                renderOnlineMembers();
            })
            .on("presence", { event: "leave" }, () => {
                state.presence = channel.presenceState();
                renderOnlineMembers();
            })
            .subscribe(async (status) => {
                if (status === "SUBSCRIBED") {
                    try {
                        await channel.track({
                            user_id: state.user.id,
                            name: getName(),
                            online_at: new Date().toISOString()
                        });
                    } catch (error) {
                        console.error(
                            "Failed to register presence:",
                            error
                        );
                    }
                }
            });

        const messageChannel = sb
            .channel(`kotoriba-messages-${roomId}`)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "chat_messages",
                    filter: `room_id=eq.${roomId}`
                },
                (payload) => {
                    if (payload.eventType === "INSERT") {
                        const newMessage = payload.new;

                        const exists = state.messages.some(
                            (item) => item.id === newMessage.id
                        );

                        if (!exists) {
                            state.messages.push(newMessage);
                            renderMessages();
                        }
                    } else if (
                        payload.eventType === "UPDATE" ||
                        payload.eventType === "DELETE"
                    ) {
                        loadMessages(roomId);
                    }
                }
            )
            .subscribe((status) => {
                if (status === "CHANNEL_ERROR") {
                    console.error(
                        "Message realtime channel error."
                    );
                }
            });

        state.messageChannel = messageChannel;
    }

    function getUniqueOnlineMembers() {
        const members = new Map();

        for (const [, entries] of Object.entries(state.presence || {})) {
            if (!Array.isArray(entries)) continue;

            for (const entry of entries) {
                const userId = entry.user_id;
                if (!userId) continue;

                /*
                 * Deduplicate by user ID so multiple tabs
                 * do not inflate the online count.
                 */
                if (!members.has(userId)) {
                    members.set(userId, {
                        user_id: userId,
                        name: entry.name || "Guest"
                    });
                }
            }
        }

        return [...members.values()];
    }

    function renderOnlineMembers() {
        const countElement =
            $("onlineCount") ||
            $("onlineUserCount");

        const listElement =
            $("onlineMembers") ||
            $("onlineMemberList");

        const members = getUniqueOnlineMembers();

        if (countElement) {
            countElement.textContent = String(members.length);
        }

        if (!listElement) return;

        if (!members.length) {
            listElement.innerHTML =
                '<p class="online-empty">オンラインのメンバーはいません</p>';
            return;
        }

        listElement.innerHTML = members.map((member) => {
            const name = escapeHTML(member.name);
            const isMe = member.user_id === state.user?.id;

            return `
                <div class="online-member">
                    <span class="online-indicator" aria-hidden="true"></span>
                    <span class="online-member-name">${name}</span>
                    ${isMe
                        ? '<span class="online-you">あなた</span>'
                        : ""}
                </div>
            `;
        }).join("");
    }

    async function changeName() {
        const name = getName();

        if (!name) {
            setStatus("名前を入力してください。", true);
            return;
        }

        saveName(name);

        if (state.room && state.channel) {
            try {
                await state.channel.track({
                    user_id: state.user.id,
                    name,
                    online_at: new Date().toISOString()
                });
            } catch (error) {
                console.error("Failed to update presence:", error);
            }

            const { error } = await sb
                .from("room_members")
                .update({ member_name: name })
                .eq("room_id", state.room.id)
                .eq("user_id", state.user.id);

            if (error) {
                console.warn(
                    "Could not update room member name:",
                    error.message
                );
            }

            renderOnlineMembers();
        }

        setStatus("名前を変更しました。");
    }

    async function leaveRoom() {
        showLobby();
    }

    function bindClick(ids, handler) {
        for (const id of ids) {
            const element = $(id);
            if (element) {
                element.addEventListener("click", handler);
            }
        }
    }

    function bindEnter(ids, handler) {
        for (const id of ids) {
            const element = $(id);
            if (!element) continue;

            element.addEventListener("keydown", (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handler();
                }
            });
        }
    }

    function bindEvents() {
        bindClick(
            ["createRoomButton", "createRoomBtn"],
            createRoom
        );

        bindClick(
            ["sendButton", "sendMessageButton"],
            sendMessage
        );

        bindClick(
            ["leaveRoomButton", "backToLobbyButton"],
            leaveRoom
        );

        bindClick(
            ["changeNameButton", "saveNameButton"],
            changeName
        );

        bindClick(
            ["refreshRoomsButton", "refreshRooms"],
            loadRooms
        );

        bindEnter(
            ["messageInput", "message"],
            sendMessage
        );

        const nameInput = $("nameInput") || $("displayName");
        if (nameInput && state.name) {
            nameInput.value = state.name;
        }
    }

    async function init() {
        bindEvents();

        try {
            await ensureAuth();

            if (state.name) {
                saveName(state.name);
            }

            await loadRooms();

            show($("lobbyScreen"));
            hide($("chatScreen"));

            renderOnlineMembers();
            setStatus("ことりばへようこそ！");
        } catch (error) {
            console.error("Initialization failed:", error);
            setStatus(
                "初期化に失敗しました。Supabase の設定を確認してください。",
                true
            );
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
