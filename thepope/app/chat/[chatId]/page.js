import { auth } from 'thepopebot/auth';
import { ChatPage } from 'thepopebot/chat';

export default async function ChatRoute({ params }) {
  const { chatId } = await params;
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} chatId={chatId} />;
}
