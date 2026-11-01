import StudyApp from './study-app';
import {userId} from '@/lib/server-auth';
import {env} from 'cloudflare:workers';
import {authConfiguration} from '@/lib/auth-service';
import {sitesLegacyOrigin} from '@/lib/sites-legacy-identity';
export const dynamic='force-dynamic';
export default async function Home(){return <StudyApp owner={await userId()} accountAvailable={!!authConfiguration(env)} legacyAvailable={!!sitesLegacyOrigin(env)} remoteLearningEnabled={false}/>;}
