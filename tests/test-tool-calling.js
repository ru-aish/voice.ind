const { ToolExecutor } = require('../src/tools/tool-executor');
const { toolDefinitions, toolMap } = require('../src/tools/tool-registry');

const executor = new ToolExecutor({ apiBaseUrl: 'http://localhost:3002' });

function printResult(testName, result) {
  console.log(`\n=== ${testName} ===`);
  console.log(JSON.stringify(result, null, 2));
}

async function runTests() {
  console.log('Tool Calling Tests\n');
  console.log('Available tools:', toolDefinitions.map(t => t.function?.name).join(', '));
  console.log('API Base URL: http://localhost:3002\n');

  console.log('--- Test 1: check_availability ---');
  const availabilityResult = await executor.execute('check_availability', {
    date: '2026-02-20',
    timePreference: 'morning'
  });
  printResult('check_availability result', availabilityResult);

  console.log('\n--- Test 2: book_demo ---');
  const bookResult = await executor.execute('book_demo', {
    leadName: 'Test User',
    email: 'test@example.com',
    phone: '+1-555-1234',
    company: 'Test Company',
    date: '2026-02-20',
    time: '10:00',
    duration: '30',
    notes: 'Test booking from automated test'
  });
  printResult('book_demo result', bookResult);

  console.log('\n--- Test 3: capture_lead_info ---');
  const leadResult = await executor.execute('capture_lead_info', {
    name: 'John Doe',
    email: 'john.doe@example.com',
    phone: '+1-555-9876',
    company: 'Acme Corp',
    interest: 'Voice AI Solutions'
  });
  printResult('capture_lead_info result', leadResult);

  console.log('\n=== All tests completed ===');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
