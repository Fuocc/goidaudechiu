const supabase = require('./supabaseClient');

async function test() {
  try {
    console.log('1. Fetching a customer to use as a placeholder...');
    const { data: customers, error: custErr } = await supabase
      .from('customers')
      .select('*')
      .limit(1);
    
    if (custErr) {
      console.error('Customer fetch error:', custErr);
      return;
    }
    console.log('Sample Customer:', customers[0]);

    console.log('\n2. Testing if we can insert a booking with status "hold"...');
    // Let's try to insert a dummy booking with status 'hold'
    const testBooking = {
      customer_id: customers[0].id,
      branch_id: '00000000-0000-0000-0000-000000000000', // We will fetch a real branch next if this fails, or use a real branch
      booking_date: '2026-05-20',
      start_time: '12:00',
      end_time: '13:00',
      status: 'hold',
      num_guests: 1,
      total_price: 0
    };

    // Let's get a real branch first to make sure it exists
    const { data: branches } = await supabase.from('branches').select('id').limit(1);
    if (branches && branches.length > 0) {
      testBooking.branch_id = branches[0].id;
    }
    // Let's get an employee
    const { data: employees } = await supabase.from('employees').select('id').limit(1);
    if (employees && employees.length > 0) {
      testBooking.employee_id = employees[0].id;
    }
    // Let's get a bed
    const { data: beds } = await supabase.from('beds').select('id').limit(1);
    if (beds && beds.length > 0) {
      testBooking.bed_id = beds[0].id;
    }

    console.log('Inserting payload:', testBooking);
    const { data: inserted, error: insertErr } = await supabase
      .from('bookings')
      .insert([testBooking])
      .select();

    if (insertErr) {
      console.log('Insert failed (this might mean "hold" status is not allowed or other field missing):', insertErr.message);
    } else {
      console.log('Insert succeeded! Created booking hold:', inserted[0]);
      // Clean up
      console.log('Cleaning up...');
      await supabase.from('bookings').delete().eq('id', inserted[0].id);
      console.log('Cleaned up successfully.');
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

test();
