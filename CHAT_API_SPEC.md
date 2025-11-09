# Chat API Specification - Studious LMS

## Overview

Real-time chat system with support for direct messages (DMs) and group conversations, featuring mentions and separate unread tracking.

### Stack
- **Backend**: tRPC + Prisma + PostgreSQL
- **Real-time**: Pusher
- **Authentication**: Bearer token in `Authorization` header

---

## 🔐 Authentication

All chat endpoints require authentication via Bearer token:
```typescript
headers: {
  'Authorization': 'Bearer <your-session-token>'
}
```

---

## 📝 Data Models

### Conversation Types
```typescript
type ConversationType = 'DM' | 'GROUP';
type ConversationRole = 'ADMIN' | 'MEMBER';
```

### User Object
```typescript
interface User {
  id: string;
  username: string;
  profile?: {
    displayName?: string;
    profilePicture?: string;
  };
}
```

### Conversation Object
```typescript
interface Conversation {
  id: string;
  type: ConversationType;
  name?: string; // Required for GROUP, null for DM
  createdAt: Date;
  updatedAt: Date;
  members: ConversationMember[];
  lastMessage?: Message;
  unreadCount: number;
  unreadMentionCount: number;
}

interface ConversationMember {
  id: string;
  userId: string;
  conversationId: string;
  role: ConversationRole;
  joinedAt: Date;
  lastViewedAt?: Date;
  lastViewedMentionAt?: Date;
  user: User;
}
```

### Message Object
```typescript
interface Message {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
  sender: User;
  mentions: Array<{ user: User }>;
  mentionsMe: boolean; // True if current user is mentioned
}
```

---

## 💬 Conversation Endpoints

### `conversation.list`
**Type**: Query  
**Description**: Get all conversations for current user with unread counts

**Input**: None

**Output**:
```typescript
Array<{
  id: string;
  type: 'DM' | 'GROUP';
  name?: string;
  createdAt: Date;
  updatedAt: Date;
  members: ConversationMember[];
  lastMessage?: Message;
  unreadCount: number;        // Regular unread messages
  unreadMentionCount: number; // Unread mentions
}>
```

**Example**:
```typescript
const conversations = await trpc.conversation.list.query();
```

---

### `conversation.create`
**Type**: Mutation  
**Description**: Create a new conversation (DM or Group)

**Input**:
```typescript
{
  type: 'DM' | 'GROUP';
  name?: string;        // Required for GROUP
  memberIds: string[];  // User IDs to add (1 for DM, multiple for GROUP)
}
```

**Output**: `Conversation`

**Examples**:
```typescript
// Create DM
const dmConversation = await trpc.conversation.create.mutate({
  type: 'DM',
  memberIds: ['user-123']
});

// Create Group
const groupConversation = await trpc.conversation.create.mutate({
  type: 'GROUP',
  name: 'Project Team',
  memberIds: ['user-123', 'user-456', 'user-789']
});
```

**Notes**:
- For DMs: Automatically detects and returns existing DM if it exists
- For Groups: Creator becomes ADMIN, others become MEMBER
- All memberIds must be valid user IDs

---

### `conversation.get`
**Type**: Query  
**Description**: Get specific conversation details

**Input**:
```typescript
{
  conversationId: string;
}
```

**Output**: `Conversation`

**Example**:
```typescript
const conversation = await trpc.conversation.get.query({
  conversationId: 'conv-123'
});
```

---

## 💬 Message Endpoints

### `message.list`
**Type**: Query  
**Description**: Get paginated messages for a conversation (lazy loading)

**Input**:
```typescript
{
  conversationId: string;
  cursor?: string;     // ISO date string for pagination
  limit?: number;      // Default: 50, Max: 100
}
```

**Output**:
```typescript
{
  messages: Message[];
  nextCursor?: string; // Use for next page
}
```

**Example**:
```typescript
// Get first page
const firstPage = await trpc.message.list.query({
  conversationId: 'conv-123',
  limit: 20
});

// Get next page
const nextPage = await trpc.message.list.query({
  conversationId: 'conv-123',
  cursor: firstPage.nextCursor,
  limit: 20
});
```

**Notes**:
- Messages are returned in chronological order (oldest first)
- Use `cursor` for infinite scroll pagination
- Each message includes mention info and `mentionsMe` flag

---

### `message.send`
**Type**: Mutation  
**Description**: Send a new message with optional mentions

**Input**:
```typescript
{
  conversationId: string;
  content: string;              // 1-4000 characters
  mentionedUserIds?: string[];  // Optional user IDs to mention
}
```

**Output**:
```typescript
{
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
  sender: User;
  mentionedUserIds: string[];
}
```

**Example**:
```typescript
// Regular message
const message = await trpc.message.send.mutate({
  conversationId: 'conv-123',
  content: 'Hello everyone!'
});

// Message with mentions
const mentionMessage = await trpc.message.send.mutate({
  conversationId: 'conv-123',
  content: 'Hey @john, can you review this?',
  mentionedUserIds: ['user-john-id']
});
```

**Notes**:
- Mentioned users must be members of the conversation
- Broadcasts real-time event to all conversation members
- Updates conversation's `updatedAt` timestamp

---

### `message.markAsRead`
**Type**: Mutation  
**Description**: Mark all messages in conversation as read

**Input**:
```typescript
{
  conversationId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
}
```

**Example**:
```typescript
await trpc.message.markAsRead.mutate({
  conversationId: 'conv-123'
});
```

**Notes**:
- Updates user's `lastViewedAt` timestamp for the conversation
- Affects `unreadCount` but NOT `unreadMentionCount`
- Broadcasts `conversation-viewed` event

---

### `message.markMentionsAsRead`
**Type**: Mutation  
**Description**: Mark all mentions in conversation as read (separate from regular messages)

**Input**:
```typescript
{
  conversationId: string;
}
```

**Output**:
```typescript
{
  success: boolean;
}
```

**Example**:
```typescript
await trpc.message.markMentionsAsRead.mutate({
  conversationId: 'conv-123'
});
```

**Notes**:
- Updates user's `lastViewedMentionAt` timestamp
- Affects `unreadMentionCount` but NOT `unreadCount`
- Broadcasts `mentions-viewed` event

---

### `message.getUnreadCount`
**Type**: Query  
**Description**: Get unread counts for a conversation

**Input**:
```typescript
{
  conversationId: string;
}
```

**Output**:
```typescript
{
  unreadCount: number;        // Regular unread messages
  unreadMentionCount: number; // Unread mentions
}
```

**Example**:
```typescript
const counts = await trpc.message.getUnreadCount.query({
  conversationId: 'conv-123'
});

// Use for UI badges
if (counts.unreadMentionCount > 0) {
  // Show red mention badge
} else if (counts.unreadCount > 0) {
  // Show regular unread badge
}
```

---

## 🔴 Real-time Events (Pusher)

### Channel Pattern
Subscribe to: `conversation-{conversationId}`

### Events

#### `new-message`
**Triggered**: When someone sends a message  
**Payload**:
```typescript
{
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
  sender: User;
  mentionedUserIds: string[];
}
```

#### `conversation-viewed`
**Triggered**: When someone marks messages as read  
**Payload**:
```typescript
{
  userId: string;
  viewedAt: Date;
}
```

#### `mentions-viewed`
**Triggered**: When someone marks mentions as read  
**Payload**:
```typescript
{
  userId: string;
  viewedAt: Date;
}
```

### Frontend Integration Example
```typescript
import Pusher from 'pusher-js';

const pusher = new Pusher('your-pusher-key', {
  cluster: 'your-cluster'
});

// Subscribe to conversation
const channel = pusher.subscribe(`conversation-${conversationId}`);

// Listen for new messages
channel.bind('new-message', (data) => {
  // Add message to UI
  addMessageToUI(data);
  
  // Check if user is mentioned
  if (data.mentionedUserIds.includes(currentUserId)) {
    // Show mention notification
    showMentionNotification(data);
  }
});

// Listen for read receipts
channel.bind('conversation-viewed', (data) => {
  // Update read indicators
  updateReadIndicators(data.userId, data.viewedAt);
});
```

---

## 🎨 UI/UX Guidelines

### Unread Indicators
```typescript
// Conversation list item
function ConversationItem({ conversation }) {
  const { unreadCount, unreadMentionCount } = conversation;
  
  return (
    <div className="conversation-item">
      <div className="conversation-info">
        {/* Conversation details */}
      </div>
      
      <div className="badges">
        {unreadMentionCount > 0 && (
          <Badge variant="mention" count={unreadMentionCount} />
        )}
        {unreadCount > 0 && (
          <Badge variant="regular" count={unreadCount} />
        )}
      </div>
    </div>
  );
}
```

### Message Display
```typescript
function MessageItem({ message, currentUserId }) {
  const isMentioned = message.mentionsMe;
  const isOwnMessage = message.senderId === currentUserId;
  
  return (
    <div className={`message ${isMentioned ? 'mentioned' : ''} ${isOwnMessage ? 'own' : ''}`}>
      <div className="message-header">
        <span className="sender">{message.sender.profile?.displayName || message.sender.username}</span>
        <span className="timestamp">{formatTime(message.createdAt)}</span>
      </div>
      
      <div className="message-content">
        {renderMessageWithMentions(message.content, message.mentions)}
      </div>
    </div>
  );
}
```

### Mention Input
```typescript
// When user types @username, suggest users from conversation members
function MessageInput({ conversationId, members }) {
  const [content, setContent] = useState('');
  const [mentionedUsers, setMentionedUsers] = useState<string[]>([]);
  
  const handleSend = async () => {
    await trpc.message.send.mutate({
      conversationId,
      content,
      mentionedUserIds: mentionedUsers
    });
    
    setContent('');
    setMentionedUsers([]);
  };
  
  // Implement @mention autocomplete logic
}
```

---

## ⚠️ Error Handling

### Common Error Codes
- `UNAUTHORIZED`: Invalid or missing authentication
- `FORBIDDEN`: Not a member of the conversation
- `NOT_FOUND`: Conversation doesn't exist
- `BAD_REQUEST`: Invalid input (e.g., mentioned user not in conversation)

### Error Response Format
```typescript
{
  error: {
    code: string;
    message: string;
    data?: any;
  }
}
```

---

## 🚀 Implementation Checklist

### Basic Chat
- [ ] Display conversation list with unread counts
- [ ] Create DM conversations
- [ ] Send and receive messages
- [ ] Real-time message updates
- [ ] Mark conversations as read

### Advanced Features
- [ ] Create group conversations
- [ ] @mention autocomplete
- [ ] Separate mention/regular unread tracking
- [ ] Mention notifications
- [ ] Message pagination/infinite scroll
- [ ] Typing indicators (optional)
- [ ] Message search (optional)

### UI Components Needed
- [ ] ConversationList
- [ ] ConversationItem  
- [ ] MessageList
- [ ] MessageItem
- [ ] MessageInput
- [ ] MentionAutocomplete
- [ ] UnreadBadge
- [ ] UserAvatar

---

## 📱 Mobile Considerations

- Use appropriate notification permissions
- Handle app backgrounding/foregrounding
- Implement proper connection management for Pusher
- Consider offline message queuing

---

**Generated**: September 22, 2025  
**Version**: 1.0  
**Backend Version**: Compatible with Studious LMS Server v1.1.8+
