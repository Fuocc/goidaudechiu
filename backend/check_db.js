const supabase = require('./supabaseClient');

async function setupSettingsTable() {

  // Try to query the table
  const { error } = await supabase.from('settings').select('key').limit(1);
  
  if (error && error.code === '42P01') { // 42P01 is "undefined_table" in Postgres

    // Using rpc to run arbitrary SQL is usually disabled for safety, 
    // but some setups allow it. Let's try a direct query if possible, 
    // or just inform the user.
    // Actually, Supabase JS client doesn't support CREATE TABLE directly.

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

  } else {

  }
}

setupSettingsTable();
