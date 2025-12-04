// Direct test of Gemini API
// 
// SETUP:
// 1. Copy this file: cp test-gemini-direct.example.js test-gemini-direct.js
// 2. Set environment variable: export GEMINI_API_KEY=your-key-here
// 3. Run: node test-gemini-direct.js
//
// NEVER commit test-gemini-direct.js with real API keys!

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY environment variable is not set');
  console.error('\nUsage:');
  console.error('  Windows PowerShell: $env:GEMINI_API_KEY="your-key"; node test-gemini-direct.js');
  console.error('  Linux/Mac: GEMINI_API_KEY=your-key node test-gemini-direct.js');
  console.error('\nGet your API key from: https://aistudio.google.com/app/apikey');
  process.exit(1);
}

async function testDirect() {
  console.log('🧪 Testing Gemini API directly...\n');
  console.log('🔑 Using API key from environment variable');
  console.log('📡 Testing model: gemini-2.5-flash\n');
  
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
      console.log('\n✨ Your Gemini API key is valid and working!');
    } else {
      console.log('❌ FAILED:\n', JSON.stringify(data, null, 2));
      
      if (data.error?.code === 400) {
        console.error('\n💡 Tip: Check if your API key has the correct permissions');
      } else if (data.error?.code === 404) {
        console.error('\n💡 Tip: The model "gemini-2.5-flash" might not be available in your region');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testDirect();

