const express = require('express');
const AuthService = require('./AuthService');

const router = express.Router();
const authService = new AuthService();

// Signup endpoint
router.post('/signup', async (req, res) => {
  try {
    const result = await authService.signup(req.body);
    
    res.status(201).json({
      success: true,
      message: result.message,
      data: {
        user: result.user,
        redirectTo: result.redirectTo
      },
      token: result.token
    });
  } catch (error) {
    console.error('Signup error:', error);
    
    res.status(400).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password);
    
    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        user: result.user
      },
      token: result.token
    });
  } catch (error) {
    console.error('Login error:', error);
    
    res.status(401).json({
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Check email availability
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const emailCheck = await authService.checkEmailExists(email);
    
    res.status(200).json({
      success: true,
      available: !emailCheck.exists,
      message: emailCheck.exists 
        ? `This email is already registered as a ${emailCheck.userType}` 
        : 'Email is available'
    });
  } catch (error) {
    console.error('Email check error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to check email availability',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Verify token endpoint
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    const user = await authService.getUserByToken(token);
    
    res.status(200).json({
      success: true,
      message: 'Token is valid',
      data: {
        user: {
          id: user.id || user.customerId,
          email: user.email,
          role: user.role || 'customer',
          name: user.name
        }
      }
    });
  } catch (error) {
    console.error('Token verification error:', error);
    
    res.status(401).json({
      success: false,
      message: error.message
    });
  }
});

// Get user roles
router.get('/roles', (req, res) => {
  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Manager' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'customer', label: 'Customer' },
    { value: 'rake_planner', label: 'Rake Planner' },
    { value: 'yard', label: 'Yard Operator' }
  ];

  res.status(200).json({
    success: true,
    data: { roles }
  });
});

// Logout endpoint (client-side token removal, optional server-side blacklist)
router.post('/logout', async (req, res) => {
  try {
    // For now, just respond success (client should remove token)
    // In a more advanced setup, you could blacklist the token
    
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to logout'
    });
  }
});

module.exports = router;