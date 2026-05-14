require('dotenv').config();
const connectDB = require('./config/db');
const Role = require('./models/Role');
const User = require('./models/User');

const REMOVE_SLUGS = ['admin', 'staff', 'hospital', 'tester'];

const run = async () => {
  await connectDB();

  for (const slug of REMOVE_SLUGS) {
    const role = await Role.findOne({ slug });
    if (!role) { console.log(`  skip: ${slug} not found`); continue; }

    // Reassign any users on this role to an appropriate replacement
    const replacement = await Role.findOne({
      slug: slug.startsWith('hospital') ? 'hospital_admin' : 'fcc_staff'
    });
    const updated = await User.updateMany({ role: role._id }, { role: replacement?._id });
    if (updated.modifiedCount) {
      console.log(`  reassigned ${updated.modifiedCount} user(s) from "${role.name}" → "${replacement?.name}"`);
    }

    await Role.deleteOne({ _id: role._id });
    console.log(`  deleted role: ${role.name} (${slug})`);
  }

  console.log('Done.');
  process.exit(0);
};

run().catch(err => { console.error(err); process.exit(1); });
