/* eslint-env browser */
// @ts-nocheck
/* eslint import/no-unresolved: "off" */
import { LitElement, html, css } from "https://cdn.jsdelivr.net/gh/lit/dist@3/all/lit-all.min.js";

import { io } from "https://cdn.socket.io/4.8.1/socket.io.esm.min.js";

import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";

class ChatApp extends LitElement {
	static styles = css`
		:host {
			display: block;
			font-family: Arial, sans-serif;
		}

		.container {
			width: 100%;
			max-width: 600px;
			margin: 0 auto;
			border: 1px solid #ddd;
			border-radius: 8px;
			box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
			background-color: #f9f9f9;
			overflow: hidden;
		}

		#chat_history {
			height: 300px;
			overflow-y: auto;
			padding: 16px;
			background-color: #fff;
			border-bottom: 1px solid #ddd;
			display: flex;
			flex-direction: column;
		}

		#chat_history .msg_from_user,
		#chat_history .msg_from_bot {
			margin-bottom: 8px;
			padding: 8px;
			border-radius: 4px;
			max-width: 90%; /* Maximum width of 90% of the container */
			width: auto; /* Auto width based on content */
			word-wrap: break-word; /* Ensure long words wrap */
		}

		#chat_history .msg_from_user {
			background-color: #d1e7dd;
			color: #333;
			align-self: flex-end; /* Align user messages to the right */
			text-align: right;
		}

		#chat_history .msg_from_bot {
			background-color: #e6f7ff;
			color: #333;
			align-self: flex-start; /* Align bot messages to the left */
			text-align: left;
			position: relative; /* Required for positioning the pseudo-element */
		}
		#chat_history .msg_from_bot:after {
			content: "";
			background-image: url("img/logo200.jpeg");
			background-size: cover;
			background-position: center;
			width: 24px; /* Set the size of the logo */
			height: 24px;
			position: absolute;
			top: 50%; /* Center vertically */
			right: -8px; /* Position the image on the right side */
			transform: translateY(-50%); /* Adjust for vertical centering */
			border-radius: 50%; /* Optional: Make the image circular */
		}
		#chat_input {
			display: flex;
			padding: 8px;
			background-color: #f1f1f1;
		}

		#message_input {
			flex: 1;
			padding: 8px;
			border: 1px solid #ddd;
			border-radius: 4px;
			font-size: 14px;
		}

		#send_button {
			margin-left: 8px;
			padding: 8px 16px;
			border: none;
			border-radius: 4px;
			background-color: #007bff;
			color: #fff;
			font-size: 14px;
			cursor: pointer;
		}

		#send_button:hover {
			background-color: #0056b3;
		}
	`;

	static properties = {
		history: { type: Array },
	};

	constructor() {
		super();
		this.socket = io();
		this.socket.on("message", this.onMessage.bind(this));
		this.history = [];
	}
	onMessage(msg) {
		console.log("Received message:", msg);
		const message = html`<div class="msg_from_bot">${marked(msg.content)}</div>`;
		this.history.push(message);
		this.requestUpdate();
		this.scrollToBottom(); // Scroll to the bottom after receiving a message
	}
	setHistory(history) {
		console.log("Setting history:", history);
		this.history = history
			.filter((item) => item.role != "system")
			.map((item) => {
				if (item.role === "user") {
					return html`<div class="msg_from_user">${marked.parse(item.content)}</div>`;
				} else if (item.role === "assistant") {
					return html`<div class="msg_from_bot">${marked.parse(item.content)}</div>`;
				}
			});
	}
	sendMessage() {
		const input = this.shadowRoot.getElementById("message_input");
		this.socket.emit("message", input.value);
		this.history.push(html`<div class="msg_from_user">${marked(input.value)}</div>`);
		input.value = "";
		this.requestUpdate();
		this.scrollToBottom(); // Scroll to the bottom after sending a message
	}
	scrollToBottom() {
		const chatHistory = this.shadowRoot.getElementById("chat_history");
		if (chatHistory) {
			window.setTimeout(() => {
				chatHistory.scrollTop = chatHistory.scrollHeight;
			}, 100); // Scroll to the bottom
		}
	}
	render() {
		return html`
			<div class="container">
				<div id="chat_history">${this.history.map((item) => item)}</div>
				<div id="chat_input">
					<input type="text" id="message_input" placeholder="Type your message here..." />
					<button @click="${this.sendMessage}" id="send_button">Send</button>
				</div>
			</div>
		`;
	}
}

customElements.define("chat-app", ChatApp);
