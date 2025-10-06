import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json({
        success: false,
        message: 'Email is required'
      }, { status: 400 });
    }

    // Mock email check - in real implementation, check database
    // For demo, simulate some emails as taken
    const takenEmails = ['admin@example.com', 'manager@example.com', 'test@example.com'];
    const isEmailTaken = takenEmails.includes(email.toLowerCase());

    return NextResponse.json({
      success: true,
      available: !isEmailTaken,
      message: isEmailTaken 
        ? 'This email is already registered as a user' 
        : 'Email is available'
    }, { status: 200 });

  } catch (error) {
    console.error('Email check API error:', error);
    return NextResponse.json({
      success: false,
      message: 'Failed to check email availability'
    }, { status: 500 });
  }
}