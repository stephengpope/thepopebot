import { redirect } from 'next/navigation';
import { auth } from 'thepopebot/auth';
import { ProfileTeamsPage } from 'thepopebot/chat';
import { getTeamsProfileInitial } from 'thepopebot/chat/teams-profile';

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect('/signin');

  const initial = await getTeamsProfileInitial(session.user.id);
  return <ProfileTeamsPage initial={initial} />;
}
