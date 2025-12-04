// Direct test of Gemini API with your key
const GEMINI_API_KEY = 'AIzaSyDdEzVyS9VirgrWrV5Y91Dj-4Hr1yPRiCA';

async function testDirect() {
  console.log('🧪 Testing Gemini API directly with key...\n');
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const requestBody = {
    contents: [{
      parts: [{
        text: 'You are a satellite imagery analyst. A California Wildfire will be scanned by Landsat-9 satellite. Cloud cover is 15%. Will this produce good imagery? Answer in 1 sentence.'
      }]
    }]
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    console.log(`📥 Response: ${response.status} ${response.statusText}\n`);
    
    const data = await response.json();
    
    if (data.candidates && data.candidates[0]) {
      console.log('✅ SUCCESS! Gemini API is working!\n');
      console.log('='.repeat(60));
      console.log(data.candidates[0].content.parts[0].text);
      console.log('='.repeat(60));
    } else {
      console.log('❌ FAILED:\n', JSON.stringify(data, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testDirect();

