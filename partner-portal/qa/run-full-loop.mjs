import {buildKernel} from '../service/build-kernel.mjs';
import {buildMemberKernel} from '../service/build-member-kernel.mjs';
await buildKernel();await buildMemberKernel();await import('./build-native-auth.mjs');
const {fullLoop}=await import('./full-loop-scenario.mjs');
const f=await fullLoop({continueAfterPaymentBlock:process.argv.includes('--continue')});
console.log(JSON.stringify({orderNumber:f.report.orderNumber,overall:f.report.overall||'Stopped before explicit downstream continuation',report:'.partner-qa/full-loop/report.json'}));
f.s.close();
if(f.report.executionError)process.exitCode=1;
