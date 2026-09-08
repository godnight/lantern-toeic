import React from 'react';
import {createRoot} from 'react-dom/client';
import StudyApp from '../../app/study-app';
import '../../app/globals.css';
import {installHarmonyHost} from '../../lib/native-host';
installHarmonyHost();
createRoot(document.getElementById('root')!).render(<React.StrictMode><StudyApp owner={null} nativeMode/></React.StrictMode>);
