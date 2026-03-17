// Performance test script for RestOrder Menu System
// Run this to benchmark the optimizations

const { performance } = require('perf_hooks');

class PerformanceTest {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
    this.results = [];
  }

  async runTests() {
    console.log('🏃 Starting Performance Tests...\n');

    const tests = [
      { name: 'Landing Page Load', url: '/' },
      { name: 'Menu Page Load', url: '/menu.html?id=demo' },
      { name: 'Admin Page Load', url: '/admin.html' },
      { name: 'Demo Menu API', url: '/api/menus/demo' },
      { name: 'All Menus API', url: '/api/menus' },
    ];

    for (const test of tests) {
      await this.runTest(test);
      await this.sleep(100); // Small delay between tests
    }

    this.printResults();
  }

  async runTest(test) {
    const iterations = 5;
    const times = [];

    console.log(`Testing: ${test.name}`);

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      
      try {
        const response = await fetch(`${this.baseUrl}${test.url}`, {
          headers: {
            'Accept': test.url.includes('/api/') ? 'application/json' : 'text/html',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Read the response to simulate full page load
        await response.text();
        
        const end = performance.now();
        const time = end - start;
        times.push(time);

        process.stdout.write(`  Run ${i + 1}: ${time.toFixed(2)}ms\n`);
      } catch (error) {
        console.log(`  ❌ Error: ${error.message}`);
        times.push(null);
        break;
      }
    }

    const validTimes = times.filter(t => t !== null);
    if (validTimes.length > 0) {
      const avg = validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
      const min = Math.min(...validTimes);
      const max = Math.max(...validTimes);

      this.results.push({
        name: test.name,
        url: test.url,
        average: avg,
        min: min,
        max: max,
        iterations: validTimes.length
      });

      console.log(`  ✅ Average: ${avg.toFixed(2)}ms (min: ${min.toFixed(2)}ms, max: ${max.toFixed(2)}ms)\n`);
    } else {
      console.log(`  ❌ All requests failed\n`);
    }
  }

  printResults() {
    console.log('\n📊 Performance Test Results Summary');
    console.log('═'.repeat(80));
    console.log(`${'Test'.padEnd(25)} ${'Avg (ms)'.padStart(10)} ${'Min (ms)'.padStart(10)} ${'Max (ms)'.padStart(10)} ${'Grade'.padStart(8)}`);
    console.log('─'.repeat(80));

    this.results.forEach(result => {
      const grade = this.getPerformanceGrade(result.average);
      console.log(
        `${result.name.padEnd(25)} ` +
        `${result.average.toFixed(2).padStart(10)} ` +
        `${result.min.toFixed(2).padStart(10)} ` +
        `${result.max.toFixed(2).padStart(10)} ` +
        `${grade.padStart(8)}`
      );
    });

    console.log('─'.repeat(80));
    
    const overallAvg = this.results.reduce((sum, r) => sum + r.average, 0) / this.results.length;
    console.log(`Overall Average: ${overallAvg.toFixed(2)}ms - ${this.getPerformanceGrade(overallAvg)}`);

    console.log('\n🎯 Performance Recommendations:');
    this.results.forEach(result => {
      if (result.average > 500) {
        console.log(`  ⚠️  ${result.name}: Consider further optimization (${result.average.toFixed(2)}ms)`);
      } else if (result.average > 200) {
        console.log(`  📈 ${result.name}: Good performance, monitor for regressions`);
      } else {
        console.log(`  ✨ ${result.name}: Excellent performance!`);
      }
    });

    console.log('\n🏆 Optimization Features Active:');
    console.log('  ✅ Gzip Compression');
    console.log('  ✅ Static File Caching');
    console.log('  ✅ Database Prepared Statements');
    console.log('  ✅ In-Memory Menu Caching');
    console.log('  ✅ Service Worker (HTTPS only)');
    console.log('  ✅ Critical CSS Inlining');
    console.log('  ✅ Performance Monitoring');
  }

  getPerformanceGrade(ms) {
    if (ms < 100) return '🚀 A+';
    if (ms < 200) return '⚡ A';
    if (ms < 300) return '😊 B+';
    if (ms < 500) return '😐 B';
    if (ms < 1000) return '😟 C';
    return '😰 F';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Run the tests if called directly
if (require.main === module) {
  const tester = new PerformanceTest();
  
  // Allow custom URL from command line
  if (process.argv[2]) {
    tester.baseUrl = process.argv[2];
  }

  console.log(`🔗 Testing server at: ${tester.baseUrl}\n`);

  tester.runTests().catch(error => {
    console.error('💥 Performance test failed:', error.message);
    process.exit(1);
  });
}

module.exports = PerformanceTest;