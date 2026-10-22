import AccountForm from './account-form';

export const dynamic = 'force-dynamic';

export default function AccountPage() {
  return <main className="workspace"><div className="page-content" style={{maxWidth:760}}>
    <header className="page-heading"><div><p className="eyebrow">LANTERN · 微光托业</p><h1>用户名密码账号</h1></div><a className="text-button" href="/">返回学习</a></header>
    <AccountForm />
  </div></main>;
}
