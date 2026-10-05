import { useEffect, useRef, useState } from 'react';
import { BMLogo } from './Common/BMLogo';
import { BM_CONTACT } from '../constants/contact';
import './Chatbot.css';

const WELCOME_MESSAGE = "Hi! I'm the BM Printing Assistant. How can I help you today?";
const ORDER_LOOKUP_REPLY = "I can't access live order data in this chat. Please use Track Order to check your latest status. Have your order number ready, and the system will retrieve the current information.";

const QUICK_ACTIONS = [
  { label: 'Products & Services', message: 'What products and printing services does BM Printing Services offer?' },
  { label: 'How to Order', message: 'How do I place an order with BM Printing Services?' },
  { label: 'Track an Order', message: 'How can I track my order?' },
  { label: 'Contact BM Printing', message: 'How can I contact BM Printing Services?' }
];

function isOrderLookupQuestion(message) {
  return /\b(?:order|ord[-\s]?\d+)\b/i.test(message)
    && /\b(?:where|status|ready|progress|update|done|complete|arrived)\b/i.test(message);
}

function contactReply() {
  return [
    `Phone: ${BM_CONTACT.phoneDisplay}`,
    `Email: ${BM_CONTACT.email}`,
    `Facebook: ${BM_CONTACT.facebookLabel} or ${BM_CONTACT.facebookAlternative}`,
    `Location: ${BM_CONTACT.location}`
  ].join('\n');
}

function ChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.25 11.55a7.65 7.65 0 0 1-.82 3.45 7.77 7.77 0 0 1-6.98 4.31 7.65 7.65 0 0 1-3.45-.82L3 20l1.51-5.99a7.65 7.65 0 0 1-.82-3.45 7.77 7.77 0 0 1 4.31-6.98 7.65 7.65 0 0 1 3.45-.82h.4a7.75 7.75 0 0 1 8.4 8.4v.39Z" /><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" /></svg>;
}

function CloseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.2 18-3.9-7.9L2 9.2 21 3Z" /><path d="M9.9 13.1 21 3" /></svg>;
}

function createMessage(role, text, extra = {}) {
  return { id: `${Date.now()}-${Math.random()}`, role, text, ...extra };
}

export function Chatbot({ setPage }) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState([
    createMessage('assistant', WELCOME_MESSAGE)
  ]);
  const toggleRef = useRef(null);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return undefined;
    inputRef.current?.focus();
    const closeOnEscape = event => {
      if (event.key === 'Escape') closeChat();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending, isOpen]);

  function closeChat() {
    setIsOpen(false);
    toggleRef.current?.focus();
  }

  async function sendMessage(value, options = {}) {
    const message = value.trim();
    if (!message || sendingRef.current) return;

    setMessages(current => [...current, createMessage('user', message)]);
    setDraft('');

    if (options.localReply) {
      setMessages(current => [...current, createMessage('assistant', options.localReply, options.action ? { action: options.action } : {})]);
      return;
    }

    if (isOrderLookupQuestion(message)) {
      setMessages(current => [...current, createMessage('assistant', ORDER_LOOKUP_REPLY, { action: 'track' })]);
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await response.json();
      if (!response.ok || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('Chat request failed.');
      }
      setMessages(current => [...current, createMessage('assistant', data.reply.trim())]);
    } catch {
      setMessages(current => [...current, createMessage('assistant', "Sorry, I couldn't respond right now. Please try again.")]);
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  function handleQuickAction(action) {
    if (action.label === 'Track an Order') {
      void sendMessage(action.message);
      return;
    }
    if (action.label === 'Contact BM Printing') {
      void sendMessage(action.message, { localReply: contactReply() });
      return;
    }
    void sendMessage(action.message);
  }

  function handleSubmit(event) {
    event.preventDefault();
    void sendMessage(draft);
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(draft);
    }
  }

  return (
    <div className="bm-chatbot">
      {isOpen && (
        <section className="bm-chat-panel" role="dialog" aria-label="BM Printing Assistant" aria-modal="false">
          <header className="bm-chat-header">
            <BMLogo size={40} />
            <div className="bm-chat-heading">
              <strong>BM Printing Assistant</strong>
              <span><i aria-hidden="true" /> Online</span>
            </div>
            <button className="bm-chat-close" type="button" aria-label="Close chat" onClick={closeChat}>
              <CloseIcon />
            </button>
          </header>

          <div className="bm-chat-messages" role="log" aria-label="Chat messages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`bm-chat-message bm-chat-message-${message.role}`} key={message.id}>
                <p>{message.text}</p>
                {message.action === 'track' && (
                  <button className="bm-chat-action-link" type="button" onClick={() => setPage?.('track')}>
                    Open Track Order
                  </button>
                )}
                {index === 0 && message.role === 'assistant' && (
                  <div className="bm-chat-quick-actions">
                    {QUICK_ACTIONS.map(action => (
                      <button key={action.label} type="button" onClick={() => handleQuickAction(action)}>
                        {action.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {isSending && (
              <div className="bm-chat-message bm-chat-message-assistant bm-chat-typing" role="status" aria-label="Assistant is typing">
                <span /><span /><span />
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form className="bm-chat-composer" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              aria-label="Type your message"
              placeholder="Type your message..."
              rows={1}
              maxLength={2000}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || isSending}>
              <SendIcon />
            </button>
          </form>
        </section>
      )}

      {!isOpen && <span className="bm-chat-label" aria-hidden="true">Need help?</span>}
      <button
        ref={toggleRef}
        className="bm-chat-toggle"
        type="button"
        aria-label={isOpen ? 'Close BM Printing Assistant' : 'Open BM Printing Assistant'}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(open => !open)}
      >
        {isOpen ? <CloseIcon /> : <ChatIcon />}
      </button>
    </div>
  );
}