import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // For now, we'll create a simplified version that works with the API structure
    // In a real implementation, you would import your AuthService
    
    // Mock response for development - replace with actual AuthService integration
    const { email, password, role, name, company, phone, gstin } = body;

    // Basic validation
    if (!email || !password || !role || !name) {
      return NextResponse.json({
        success: false,
        message: 'Email, password, role, and name are required'
      }, { status: 400 });
    }

    // Mock email check - in real implementation, check database
    // For now, simulate successful signup
    const mockUser = {
      id: Date.now().toString(),
      email,
      role,
      name
    };

    return NextResponse.json({
      success: true,
      message: 'Registration successful! Redirecting to login page...',
      data: {
        user: mockUser,
        redirectTo: '/login'
      },
      token: 'mock-jwt-token'
    }, { status: 201 });

  } catch (error) {
    console.error('Signup API error:', error);
    return NextResponse.json({
      success: false,
      message: 'Internal server error'
    }, { status: 500 });
  }
}