import { auth } from 'thepopebot/auth';
import { ChatPage } from 'thepopebot/chat';

export default async function Home() {
  const session = await auth();
  return <ChatPage session={session} needsSetup={false} />;
}
