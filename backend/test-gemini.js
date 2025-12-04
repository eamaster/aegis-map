// Test script for Gemini AI analysis endpoint
const API_URL = process.env.API_URL || 'https://aegis-map-backend.smah0085.workers.dev/api/analyze';

async function testGeminiAPI() {
  console.log('🧪 Testing Gemini AI Analysis Endpoint...');
  console.log(`📡 API URL: ${API_URL}\n`);
  
  const testRequest = {
    disasterTitle: 'California Wildfire',
    satelliteName: 'Landsat-9',
    passTime: '2025-12-04T15:30:00Z',
    cloudCover: 15
  };
  
  console.log('📤 Sending test request:', testRequest);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest),
    });
    
    console.log(`📥 Response status: ${response.status} ${response.statusText}\n`);
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ FAILED: Gemini API returned error');
      console.error('Error details:', JSON.stringify(data, null, 2));
      
      if (data.attempts) {
        console.error('\n📋 Models attempted:', data.attempts.join(', '));
      }
      
      if (data.details) {
        console.error('\n🔍 Last error:', JSON.stringify(data.details, null, 2));
      }
      
      return;
    }
    
    // Success!
    console.log('✅ SUCCESS: Gemini AI Analysis Working!\n');
    console.log('=' .repeat(60));
    console.log('📝 AI Analysis Response:');
    console.log('='.repeat(60));
    console.log(data.analysis);
    console.log('='.repeat(60));
    console.log(`\n✨ Analysis length: ${data.analysis.length} characters`);
    console.log(`✨ Word count: ${data.analysis.split(' ').length} words`);
    
    // Validate quality
    if (data.analysis.length < 50) {
      console.warn('\n⚠️  WARNING: Analysis is very short (< 50 chars)');
    } else if (data.analysis.length < 100) {
      console.warn('\n⚠️  WARNING: Analysis is short (< 100 chars)');
    } else {
      console.log('\n✅ Analysis quality: Good (detailed response)');
    }
    
    // Check if analysis mentions key terms
    const keywords = ['cloud', 'satellite', 'imagery', 'coverage', 'pass', 'optical'];
    const foundKeywords = keywords.filter(kw => data.analysis.toLowerCase().includes(kw));
    
    if (foundKeywords.length > 0) {
      console.log(`✅ Relevant keywords found: ${foundKeywords.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ NETWORK ERROR:', error.message);
    console.error('\nMake sure:');
    console.error('1. Backend is deployed to Cloudflare Workers');
    console.error('2. GEMINI_API_KEY secret is set in Cloudflare dashboard');
    console.error('3. The Worker URL is correct');
  }
}

// Run test
testGeminiAPI();

