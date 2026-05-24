import { redirect } from 'next/navigation';
import { auth } from 'thepopebot/auth';
import { ProfileSlackPage } from 'thepopebot/chat';
import { getSlackProfileInitial } from 'thepopebot/chat/slack-profile';

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const initial = await getSlackProfileInitial(session.user.id);
  return <ProfileSlackPage initial={initial} />;
}
