/**
 * Barrel del widget chatbot. El layout solo necesita `ChatbotWidget`; los
 * subcomponentes se exportan para unit tests.
 */
export { ChatbotWidget } from './chatbot-widget';
export { ChatbotMessageBubble } from './chatbot-message';
export { ChatbotInput } from './chatbot-input';
export { ChatbotTypingIndicator } from './chatbot-typing-indicator';
export {
  useChatbotStore,
  __resetChatbotStoreForTests,
  type ChatbotMessage,
  type ChatbotState,
} from './chatbot-store';
