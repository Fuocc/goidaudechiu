const supabase = require('./supabaseClient');

async function setupSettingsTable() {
  console.log('Checking for settings table...');
  
  // Try to query the table
  const { error } = await supabase.from('settings').select('key').limit(1);
  
  if (error && error.code === '42P01') { // 42P01 is "undefined_table" in Postgres
    console.log('Table "settings" does not exist. Attempting to create it...');
    
    // Using rpc to run arbitrary SQL is usually disabled for safety, 
    // but some setups allow it. Let's try a direct query if possible, 
    // or just inform the user.
    // Actually, Supabase JS client doesn't support CREATE TABLE directly.
    
    console.log('Please run the following SQL in your Supabase SQL Editor:');
    console.log(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      
      INSERT INTO settings (key, value) 
      VALUES ('buffer_time', '15')
      ON CONFLICT (key) DO NOTHING;
    `);
  } else if (error) {
    console.error('Error checking table:', error);
  } else {
    console.log('Table "settings" already exists.');
  }
}

setupSettingsTable();
