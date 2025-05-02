import bcrypt from 'bcrypt';
import { EOL } from 'os'; // End Of Line character for cross-platform compatibility

const saltRounds = 10; // Standard salt rounds for bcrypt

// Get password from command line arguments
const password = process.argv[2];

if (!password) {
  console.error('Usage: node generate-hash.js <password>');
  console.error('Example: node generate-hash.js mysecretpassword123');
  process.exit(1);
}

try {
  const hash = bcrypt.hashSync(password, saltRounds);
  console.log(`Password: ${password}`);
  console.log(`BCrypt Hash (Salt Rounds: ${saltRounds}):${EOL}${hash}${EOL}`);
  console.log(`---> Copy the hash above and paste it into migrations/schema.sql <---`);
} catch (error) {
  console.error('Error generating hash:', error);
  process.exit(1);
}