import StudyApp from './study-app';
import {userId} from '@/lib/server-auth';
export const dynamic='force-dynamic';
export default async function Home(){return <StudyApp owner={await userId()}/>;}
