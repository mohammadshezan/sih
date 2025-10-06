const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class AuthService {
  constructor() {
    this.saltRounds = 12;
    this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
  }

  // Generate JWT token
  generateToken(user) {
    return jwt.sign(
      { 
        id: user.id || user.customerId, 
        email: user.email, 
        role: user.role 
      },
      this.jwtSecret,
      { expiresIn: '24h' }
    );
  }

  // Hash password
  async hashPassword(password) {
    return await bcrypt.hash(password, this.saltRounds);
  }

  // Compare password
  async comparePassword(password, hashedPassword) {
    return await bcrypt.compare(password, hashedPassword);
  }

  // Validate email format
  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  // Validate role
  validateRole(role) {
    const validRoles = ['admin', 'manager', 'supervisor', 'customer', 'rake_planner', 'yard'];
    return validRoles.includes(role);
  }

  // Check if email exists for any user type
  async checkEmailExists(email) {
    // Check in User table
    const userExists = await prisma.user.findUnique({
      where: { email }
    });

    // Check in Customer table
    const customerExists = await prisma.customer.findUnique({
      where: { email }
    });

    return {
      exists: !!(userExists || customerExists),
      userType: userExists ? 'user' : customerExists ? 'customer' : null,
      user: userExists || customerExists
    };
  }

  // Signup for different roles
  async signup(userData) {
    const { email, password, role, name, company, phone, gstin } = userData;

    // Validate input
    if (!email || !password || !role) {
      throw new Error('Email, password, and role are required');
    }

    if (!this.validateEmail(email)) {
      throw new Error('Invalid email format');
    }

    if (!this.validateRole(role)) {
      throw new Error('Invalid role. Valid roles are: admin, manager, supervisor, customer, rake_planner, yard');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    // Check if email already exists
    const emailCheck = await this.checkEmailExists(email);
    if (emailCheck.exists) {
      throw new Error(`This email is already registered as a ${emailCheck.userType}. Please use a different email or try logging in.`);
    }

    // Hash password
    const hashedPassword = await this.hashPassword(password);

    let newUser;

    try {
      if (role === 'customer') {
        // Create customer
        if (!name || !company || !phone) {
          throw new Error('Name, company, and phone are required for customer registration');
        }

        newUser = await prisma.customer.create({
          data: {
            email,
            passwordHash: hashedPassword,
            name,
            company,
            phone,
            gstin: gstin || null
          }
        });
      } else {
        // Create user for other roles
        if (!name) {
          throw new Error('Name is required for user registration');
        }

        newUser = await prisma.user.create({
          data: {
            email,
            passwordHash: hashedPassword,
            role,
            name
          }
        });
      }

      // Generate token
      const token = this.generateToken(newUser);

      return {
        success: true,
        message: 'Registration successful! Redirecting to login page...',
        user: {
          id: newUser.id || newUser.customerId,
          email: newUser.email,
          role: newUser.role || 'customer',
          name: newUser.name
        },
        token,
        redirectTo: '/login'
      };

    } catch (error) {
      if (error.code === 'P2002') {
        throw new Error('This email is already registered. Please use a different email or try logging in.');
      }
      throw error;
    }
  }

  // Login for all user types
  async login(email, password) {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    if (!this.validateEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Check both User and Customer tables
    const emailCheck = await this.checkEmailExists(email);
    
    if (!emailCheck.exists) {
      throw new Error('Invalid credentials');
    }

    const user = emailCheck.user;
    let isValidPassword = false;

    // Check password based on user type
    if (emailCheck.userType === 'customer') {
      isValidPassword = await this.comparePassword(password, user.passwordHash);
    } else {
      // For non-customer users (User model)
      isValidPassword = await this.comparePassword(password, user.passwordHash);
    }

    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Generate token
    const token = this.generateToken(user);

    // Log the authentication
    if (emailCheck.userType === 'customer') {
      await prisma.authLog.create({
        data: {
          customerId: user.customerId,
          loginType: 'password'
        }
      });
    }

    return {
      success: true,
      message: 'Login successful',
      user: {
        id: user.id || user.customerId,
        email: user.email,
        role: user.role || 'customer',
        name: user.name
      },
      token
    };
  }

  // Verify JWT token
  verifyToken(token) {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  // Get user by token
  async getUserByToken(token) {
    const decoded = this.verifyToken(token);
    
    if (decoded.role === 'customer') {
      return await prisma.customer.findUnique({
        where: { customerId: decoded.id }
      });
    } else {
      return await prisma.user.findUnique({
        where: { id: decoded.id }
      });
    }
  }
}

module.exports = AuthService;