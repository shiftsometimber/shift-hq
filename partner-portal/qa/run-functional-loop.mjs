import {buildKernel} from '../service/build-kernel.mjs';
import {buildMemberKernel} from '../service/build-member-kernel.mjs';
await buildKernel();await buildMemberKernel();await import('./build-native-auth.mjs');
const {fullLoop}=await import('./full-loop-scenario.mjs');
const f=await fullLoop({sstrxCandidate:true,functionalV3:true});
console.log(JSON.stringify({overall:f.report.overall||'Incomplete',executionError:f.report.executionError||null,report:'.partner-qa/full-loop/report.json',scope:'Isolated native-auth test with simulated external transports; no hosted or supplier acceptance'}));
f.s.close();if(f.report.executionError||!f.report.overall?.startsWith('PASS'))process.exitCode=1;
