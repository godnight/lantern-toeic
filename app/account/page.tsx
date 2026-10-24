import AccountForm from './account-form';
import {env} from 'cloudflare:workers';
import {sitesLegacyOrigin} from '@/lib/sites-legacy-identity';

export const dynamic = 'force-dynamic';

export default async function AccountPage({searchParams}:{searchParams:Promise<{mode?:string;from?:string}>}) {
  const query=await searchParams;
  return <main className="workspace"><div className="page-content" style={{maxWidth:760}}>
    <header className="page-heading"><div><p className="eyebrow">LANTERN · 微光托业</p><h1>账号与安全</h1></div><a className="text-button" href="/">{query.from==='welcome'?'返回欢迎页':'返回学习'}</a></header>
    <AccountForm initialMode={query.mode==='register'?'register':'login'}/>
    {!!sitesLegacyOrigin(env)&&<section className="panel"><h2>旧版记录</h2><p>查看与导出此 Sites 账号原有的学习资料。</p><a className="button secondary" href="/legacy">查看旧版记录</a></section>}
  </div></main>;
}
