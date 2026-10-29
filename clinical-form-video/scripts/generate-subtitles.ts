import {generateSubtitles} from './subtitle-lib';

const captions = generateSubtitles();
console.log(`Generated ${captions.length} synchronized English and Traditional Chinese caption cues.`);
