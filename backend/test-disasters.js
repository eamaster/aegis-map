// Test script for disaster API endpoint
const API_URL = process.env.API_URL || 'http://localhost:8787/api/disasters';

async function testDisasters() {
  console.log('🧪 Testing /api/disasters endpoint...');
  console.log(`📡 URL: ${API_URL}\n`);
  
  try {
    const response = await fetch(API_URL);
    
    if (!response.ok) {
      console.error(`❌ HTTP Error: ${response.status} ${response.statusText}`);
      return;
    }
    
    const data = await response.json();
    
    if (!Array.isArray(data)) {
      console.error('❌ Response is not an array:', data);
      return;
    }
    
    // Count by type
    const fires = data.filter(d => d.type === 'fire').length;
    const volcanoes = data.filter(d => d.type === 'volcano').length;
    const earthquakes = data.filter(d => d.type === 'earthquake').length;
    
    console.log(`📊 Results:`);
    console.log(`🔥 Wildfires: ${fires}`);
    console.log(`🌋 Volcanoes: ${volcanoes}`);
    console.log(`🌍 Earthquakes: ${earthquakes}`);
    console.log(`📍 Total: ${data.length}\n`);
    
    // Validation
    if (fires === 0 && volcanoes === 0) {
      console.log('⚠️  WARNING: No EONET disasters found!');
      console.log('This could mean:');
      console.log('  1. No active wildfires/volcanoes globally (unlikely)');
      console.log('  2. NASA EONET API bug still present');
      console.log('  3. API endpoint changed\n');
    }
    
    // Show samples
    if (fires > 0) {
      const fireSample = data.find(d => d.type === 'fire');
      console.log('✅ Wildfire sample:', {
        title: fireSample.title,
        location: `${fireSample.lat.toFixed(2)}, ${fireSample.lng.toFixed(2)}`,
        date: fireSample.date
      });
    } else {
      console.log('⚠️  No wildfires found');
    }
    
    if (volcanoes > 0) {
      const volcanoSample = data.find(d => d.type === 'volcano');
      console.log('✅ Volcano sample:', {
        title: volcanoSample.title,
        location: `${volcanoSample.lat.toFixed(2)}, ${volcanoSample.lng.toFixed(2)}`,
        date: volcanoSample.date
      });
    } else {
      console.log('ℹ️  No active volcanoes (might be normal if none are erupting)');
    }
    
    if (earthquakes > 0) {
      const earthquakeSample = data.find(d => d.type === 'earthquake');
      console.log('✅ Earthquake sample:', {
        title: earthquakeSample.title,
        magnitude: earthquakeSample.magnitude,
        location: `${earthquakeSample.lat.toFixed(2)}, ${earthquakeSample.lng.toFixed(2)}`
      });
    }
    
    // Final verdict
    console.log('\n' + '='.repeat(50));
    if (fires > 0 || volcanoes > 0) {
      console.log('✅ SUCCESS: NASA EONET API fix is working!');
    } else {
      console.log('❌ FAIL: NASA EONET API not returning disasters');
      console.log('Manual verification needed at:');
      console.log('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires');
    }
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nMake sure the backend is running:');
    console.error('  cd backend && npm run dev');
  }
}

// Test NASA EONET API directly
async function testEonetAPI() {
  console.log('\n🔍 Testing NASA EONET API directly...\n');
  
  try {
    const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&limit=3');
    const data = await response.json();
    
    if (data.events && data.events.length > 0) {
      console.log(`✅ NASA EONET API returned ${data.events.length} wildfires`);
      console.log('Sample:', {
        title: data.events[0].title,
        categories: data.events[0].categories.map(c => c.id)
      });
    } else {
      console.log('⚠️  No wildfires returned from EONET API');
    }
  } catch (error) {
    console.error('❌ EONET API Error:', error.message);
  }
}

// Run tests
(async () => {
  await testDisasters();
  await testEonetAPI();
})();

