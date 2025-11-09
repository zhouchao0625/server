# AI Lab Chat API Specification - Studious LMS

## Overview

AI Lab Chat system extends the regular chat functionality to provide class-bound AI-powered conversations with contextual learning environments. Teachers can create lab chats with specific AI contexts, and students can interact within these structured learning spaces.

### Key Features
- **Class Integration**: Lab chats are bound to specific classes
- **AI Context**: Each lab has a JSON context string for LLM integration
- **Isolated Conversations**: Lab chats don't appear in regular chat lists
- **Teacher Management**: Only teachers can create/delete lab chats
- **Real-time Updates**: Full Pusher integration for live collaboration

---

## 🔐 Authentication

All lab chat endpoints require authentication via Bearer token and appropriate class permissions.

---

## 📝 Data Models

### LabChat Object
```typescript
interface LabChat {
  id: string;
  title: string;
  context: string; // JSON string for LLM context
  classId: string;
  conversationId: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  
  // Relations
  class: {
    id: string;
    name: string;
    subject: string;
    section: string;
  };
  createdBy: User;
  conversation: Conversation;
}
```

### Lab Chat Message
```typescript
interface LabChatMessage {
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
  sender: User;
  mentionedUserIds: string[];
  labChatId: string; // Additional context for lab chats
}
```

---

## 🧪 Lab Chat Endpoints

### `labChat.create`
**Type**: Mutation  
**Access**: Teacher Only  
**Description**: Create a new AI lab chat for a class

**Input**:
```typescript
{
  classId: string;
  title: string;        // 1-200 characters
  context: string;      // Valid JSON string for LLM context
}
```

**Output**: `LabChat` (full object with relations)

**Example**:
```typescript
const labChat = await trpc.labChat.create.mutate({
  classId: 'class-123',
  title: 'Python Debugging Lab',
  context: JSON.stringify({
    subject: 'Computer Science',
    topic: 'Python Debugging',
    difficulty: 'intermediate',
    objectives: [
      'Identify common Python errors',
      'Use debugging tools effectively',
      'Apply systematic debugging approaches'
    ],
    resources: [
      'Python documentation',
      'PDB debugger guide'
    ],
    persona: 'helpful coding mentor',
    constraints: [
      'Provide hints rather than direct answers',
      'Encourage best practices',
      'Focus on learning process'
    ]
  })
});
```

**Notes**:
- Creates a GROUP conversation with all class members
- Teachers become ADMINs, students become MEMBERs
- Lab chats have `displayInChat: false` (hidden from regular chat)
- Broadcasts `lab-chat-created` event to class channel

---

### `labChat.get`
**Type**: Query  
**Access**: Class Member  
**Description**: Get specific lab chat details

**Input**:
```typescript
{
  labChatId: string;
}
```

**Output**: `LabChat` (full object with conversation and members)

**Example**:
```typescript
const labChat = await trpc.labChat.get.query({
  labChatId: 'lab-456'
});

// Access the AI context
const aiContext = JSON.parse(labChat.context);
console.log('Lab objectives:', aiContext.objectives);
```

---

### `labChat.list`
**Type**: Query  
**Access**: Class Member  
**Description**: Get all lab chats for a class

**Input**:
```typescript
{
  classId: string;
}
```

**Output**:
```typescript
Array<{
  id: string;
  title: string;
  classId: string;
  conversationId: string;
  createdBy: User;
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: Message;
  messageCount: number;
}>
```

**Example**:
```typescript
const labChats = await trpc.labChat.list.query({
  classId: 'class-123'
});

// Display in UI
labChats.forEach(lab => {
  console.log(`${lab.title} - ${lab.messageCount} messages`);
});
```

---

### `labChat.postToLabChat`
**Type**: Mutation  
**Access**: Class Member  
**Description**: Send a message to a lab chat

**Input**:
```typescript
{
  labChatId: string;
  content: string;              // 1-4000 characters
  mentionedUserIds?: string[];  // Optional mentions
}
```

**Output**: `LabChatMessage`

**Example**:
```typescript
// Student asks a question
const message = await trpc.labChat.postToLabChat.mutate({
  labChatId: 'lab-456',
  content: 'I\'m getting a KeyError in my Python code. Can someone help?'
});

// Teacher responds with mention
const response = await trpc.labChat.postToLabChat.mutate({
  labChatId: 'lab-456',
  content: '@john Can you share the specific error traceback?',
  mentionedUserIds: ['student-john-id']
});
```

**Notes**:
- Works exactly like regular message.send but for lab contexts
- Updates lab chat `updatedAt` timestamp
- Broadcasts to conversation channel with `labChatId` context
- Perfect for AI integration on the frontend

---

### `labChat.delete`
**Type**: Mutation  
**Access**: Creator Only  
**Description**: Delete a lab chat and all associated data

**Input**:
```typescript
{
  labChatId: string;
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
await trpc.labChat.delete.mutate({
  labChatId: 'lab-456'
});
```

**Notes**:
- Only the creator (teacher) can delete
- Cascades: deletes conversation, messages, mentions, members
- Broadcasts `lab-chat-deleted` event to class channel

---

## 🔴 Real-time Events (Pusher)

### Class-Level Events
**Channel**: `class-{classId}`

#### `lab-chat-created`
```typescript
{
  id: string;
  title: string;
  classId: string;
  conversationId: string;
  createdBy: User;
  createdAt: Date;
}
```

#### `lab-chat-deleted`
```typescript
{
  labChatId: string;
  classId: string;
}
```

### Lab Chat Messages
**Channel**: `conversation-{conversationId}`

#### `new-message` (Enhanced)
```typescript
{
  id: string;
  content: string;
  senderId: string;
  conversationId: string;
  createdAt: Date;
  sender: User;
  mentionedUserIds: string[];
  labChatId: string; // Additional context for lab chats
}
```

---

## 🤖 AI Integration Guide

### Context Structure
The `context` field should be a JSON string containing AI instructions:

```typescript
interface AIContext {
  subject: string;           // Course subject
  topic: string;            // Specific topic
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  objectives: string[];     // Learning objectives
  resources?: string[];     // Available resources
  persona: string;          // AI personality/role
  constraints: string[];    // Behavioral constraints
  examples?: any[];         // Example problems/solutions
  metadata?: Record<string, any>; // Additional context
}
```

### Frontend AI Integration Example
```typescript
// Get lab chat context
const labChat = await trpc.labChat.get.query({ labChatId });
const aiContext = JSON.parse(labChat.context);

// Send to AI service with context
const aiResponse = await fetch('/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: userMessage,
    context: aiContext,
    conversationHistory: messages.slice(-10) // Last 10 messages
  })
});

// Post AI response to lab chat
await trpc.labChat.postToLabChat.mutate({
  labChatId,
  content: aiResponse.content
});
```

---

## 🎨 UI/UX Patterns

### Lab Chat List
```typescript
function LabChatList({ classId }: { classId: string }) {
  const { data: labChats } = trpc.labChat.list.useQuery({ classId });
  
  return (
    <div className="lab-chat-list">
      {labChats?.map(lab => (
        <div key={lab.id} className="lab-chat-item">
          <div className="lab-header">
            <h3>{lab.title}</h3>
            <span className="message-count">{lab.messageCount} messages</span>
          </div>
          <div className="lab-meta">
            <span>Created by {lab.createdBy.profile?.displayName || lab.createdBy.username}</span>
            <span>{formatDate(lab.createdAt)}</span>
          </div>
          {lab.lastMessage && (
            <div className="last-message">
              <strong>{lab.lastMessage.sender.username}:</strong>
              <span>{lab.lastMessage.content.substring(0, 100)}...</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

### Lab Chat Interface
```typescript
function LabChatInterface({ labChatId }: { labChatId: string }) {
  const { data: labChat } = trpc.labChat.get.useQuery({ labChatId });
  const { data: messages } = trpc.message.list.useQuery({ 
    conversationId: labChat?.conversationId 
  });
  
  const aiContext = labChat ? JSON.parse(labChat.context) : null;
  
  return (
    <div className="lab-chat-interface">
      <div className="lab-header">
        <h2>{labChat?.title}</h2>
        <div className="lab-context-preview">
          <strong>Topic:</strong> {aiContext?.topic}
          <strong>Difficulty:</strong> {aiContext?.difficulty}
        </div>
      </div>
      
      <div className="messages-area">
        {messages?.messages.map(message => (
          <MessageComponent 
            key={message.id} 
            message={message}
            isLabChat={true}
          />
        ))}
      </div>
      
      <MessageInput 
        onSend={(content, mentions) => 
          trpc.labChat.postToLabChat.mutate({
            labChatId,
            content,
            mentionedUserIds: mentions
          })
        }
        placeholder="Ask a question or share your progress..."
      />
    </div>
  );
}
```

---

## 🚀 Implementation Workflow

### For Teachers:
1. **Create Lab**: Set up lab with title and AI context
2. **Monitor Progress**: View student questions and interactions
3. **Provide Guidance**: Answer questions and guide discussions
4. **Manage Labs**: Delete completed or outdated labs

### For Students:
1. **Join Lab**: Access lab chats from class dashboard
2. **Ask Questions**: Post questions and get AI/peer help
3. **Collaborate**: Work together on problems
4. **Learn**: Benefit from AI-guided learning experience

### For AI Integration:
1. **Context Awareness**: Use lab context for relevant responses
2. **Educational Focus**: Maintain learning-oriented conversations
3. **Progress Tracking**: Monitor student understanding
4. **Adaptive Responses**: Adjust difficulty based on context

---

## 📊 Use Cases

### Programming Labs
```json
{
  "subject": "Computer Science",
  "topic": "Data Structures - Binary Trees",
  "difficulty": "intermediate",
  "objectives": [
    "Implement binary tree operations",
    "Understand tree traversal algorithms",
    "Analyze time complexity"
  ],
  "persona": "patient coding mentor",
  "constraints": [
    "Provide pseudocode hints before full solutions",
    "Encourage testing and debugging",
    "Focus on algorithmic thinking"
  ]
}
```

### Science Labs
```json
{
  "subject": "Chemistry",
  "topic": "Acid-Base Reactions",
  "difficulty": "beginner",
  "objectives": [
    "Identify acids and bases",
    "Predict reaction products",
    "Balance chemical equations"
  ],
  "persona": "encouraging science teacher",
  "resources": [
    "Periodic table",
    "pH scale reference"
  ],
  "constraints": [
    "Use simple language",
    "Provide step-by-step guidance",
    "Relate to real-world examples"
  ]
}
```

### Math Labs
```json
{
  "subject": "Mathematics",
  "topic": "Calculus - Derivatives",
  "difficulty": "advanced",
  "objectives": [
    "Apply derivative rules",
    "Solve optimization problems",
    "Interpret graphical meaning"
  ],
  "persona": "rigorous math tutor",
  "constraints": [
    "Show work step-by-step",
    "Explain reasoning behind each step",
    "Connect to geometric interpretation"
  ]
}
```

---

**Generated**: September 25, 2025  
**Version**: 1.0  
**Backend Version**: Compatible with Studious LMS Server v1.1.8+
