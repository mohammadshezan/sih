import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Basic validation
    if (!email || !password) {
      return NextResponse.json({
        success: false,
        message: 'Email and password are required'
      }, { status: 400 });
    }

    // Mock login - in real implementation, verify credentials against database
    // For demo purposes, accept any email/password combination
    const mockUser = {
      id: Date.now().toString(),
      email,
      role: 'customer', // Default role for demo
      name: 'Demo User'
    };

    return NextResponse.json({
      success: true,
      message: 'Login successful',
      data: {
        user: mockUser
      },
      token: 'mock-jwt-token'
    }, { status: 200 });

  } catch (error) {
    console.error('Login API error:', error);
    return NextResponse.json({
      success: false,
      message: 'Internal server error'
    }, { status: 500 });
  }
}