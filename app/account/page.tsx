import AccountForm from './account-form';
import {userId} from '@/lib/server-auth';
import {env} from 'cloudflare:workers';
import {sitesLegacyOrigin} from '@/lib/sites-legacy-identity';

export const dynamic = 'force-dynamic';

export default async function AccountPage({searchParams}:{searchParams:Promise<{mode?:string;from?:string}>}) {
  const query=await searchParams;
  const returnOwner=query.from==='workspace'?await userId():null;
  return <main className="workspace"><div className="page-content" style={{maxWidth:760}}>
    <AccountForm initialMode={query.mode==='register'?'register':'login'} returnOwner={returnOwner}/>
    {!!sitesLegacyOrigin(env)&&<section className="panel"><h2>旧版记录</h2><p>查看与导出此 Sites 账号原有的学习资料。</p><a className="button secondary" href="/legacy">查看旧版记录</a></section>}
  </div></main>;
}
