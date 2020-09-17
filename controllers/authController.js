// Imports
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { promisify } = require('util');

const UserModel = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');

// Sign a new JWT Token
const signJWTToken = id => {
  return jwt.sign({ id: id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN
  });
};

// Generate the Token and send a Response
const createAndSendToken = (user, statusCode, res) => {
  const myJWTtoken = signJWTToken(user._id);

  res.status(statusCode).json({
    status: 'success',
    token: myJWTtoken,
    data: {
      user
    }
  });
};

// Sign up new User.
exports.signup = catchAsync(async (req, res, next) => {
  const newUser = await UserModel.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    passwordChangedAt: req.body.passwordChangedAt,
    role: req.body.role
  });

  createAndSendToken(newUser, 201, res);
});

// Login an existing User
exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  // Check if the request contains email & password
  if (!email || !password) {
    return next(new AppError('Please Provide a valid E-mail and Password', 400));
  }

  // Check if the E-mail and Password are correct
  const user = await UserModel.findOne({ email: email }).select('+password');

  if (!user || !(await user.checkCorrectPassword(password, user.password))) {
    return next(new AppError('Incorrect E-mail or Password', 401));
  }

  // If Correct, Sign the token and Send the Response
  createAndSendToken(user, 200, res);
});

// Route Protection
exports.protectRoute = catchAsync(async (req, res, next) => {
  // 1 -> GET THE TOKEN
  // Get the Token from the header and check if it exists
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check if the token exists
  if (!token) {
    return next(new AppError('You are not logged in. Please Login to gain Access', 401));
  }

  // 2 -> TOKEN VERIFICATION
  // If the token exists, then we need to verify if the token is valid.
  const decodedToken = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  // 3 -> USER CHECK
  // Check if the user still exists in Our database / Check if the user was not deleted
  const currentUserExists = await UserModel.findById(decodedToken.id);
  if (!currentUserExists) {
    return next(new AppError('The User corresponding to the token does not exist!.', 401));
  }

  // 4 -> CHECH FOR CHANGED PASSWORD
  // Check if the token is generated from the current password
  if (currentUserExists.checkPasswordChanged(decodedToken.iat)) {
    return next(new AppError('The password was recently changed, Please Login again', 401));
  }

  // GRANT ACCESS TO THE ROUTE
  req.user = currentUserExists;
  next();
});

// Restrict the route access to only admin and lead-guide
exports.restrictRoute = (...roles) => {
  // The Parameter (roles) here is an array.
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('You do not have permission to access this route', 403));
    }

    next();
  };
};

// Route to change the password with only the E-mail address
exports.forgotPassword = catchAsync(async (req, res, next) => {
  // Get the User's E-mail address from the POST request
  const currentUser = await UserModel.findOne({ email: req.body.email });
  if (!currentUser) {
    return next(new AppError('The User with this E-mail address does not exist', 404));
  }

  // Generate the Random reset token to send it to the user
  const resetToken = currentUser.createPasswordResetToken();
  await currentUser.save({ validateBeforeSave: false });

  // Send an E-mail to the User with the Generated token
  const resetURL = `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;
  const message = `Hello! \n You seem to have lost your password. Please click on the link below to reset Your Password: \n Click Here: ${resetURL} \n If you did not Initiate the process. Please Ignore.`;
  const subject = `Hello, Your Password Reset Token is here. (valid for 10 mins).`;

  try {
    await sendEmail({
      email: req.body.email,
      subject,
      message
    });

    res.status(200).json({
      status: 'success',
      message: 'Token has been send to the designated email!'
    });
  } catch (err) {
    currentUser.passwordResetToken = undefined;
    currentUser.passwordResetTokenExpires = undefined;
    await currentUser.save({ validateBeforeSave: false });
    console.log(err);
    return next(new AppError('There was a problem in sending the email!'), 500);
  }
});

// Route to change the password with both the E-mail address and the Current Password
exports.resetPassword = catchAsync(async (req, res, next) => {
  // Get the User based on the Token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const currentUser = await UserModel.findOne({ passwordResetToken: hashedToken, passwordResetTokenExpires: { $gt: Date.now() } });

  // If the token has not expired and there is a User, set New Password
  if (!currentUser) {
    return next(new AppError('The Token is invalid or has expired.', 400));
  }

  currentUser.password = req.body.password;
  currentUser.passwordConfirm = req.body.passwordConfirm;
  currentUser.passwordResetToken = undefined;
  currentUser.passwordResetTokenExpires = undefined;

  await currentUser.save();

  // Update the passwordChangedAt property to the current time (Middleware Function).
  // Log the User in, Send a JWT
  createAndSendToken(currentUser, 200, res);
});

// Route to change the password with the Current Password
exports.updatePassword = catchAsync(async (req, res, next) => {
  // Get the Current User
  const currentUser = await UserModel.findById(req.user.id).select('+password');

  // Check if the the Posted password is correct
  if (!(await currentUser.checkCorrectPassword(req.body.passwordCurrent, currentUser.password))) {
    return next(new AppError('Your existing password is not correct. Please Re-enter the password', 401));
  }

  // If Correct, Update Password
  currentUser.password = req.body.password;
  currentUser.passwordConfirm = req.body.passwordConfirm;

  await currentUser.save();

  createAndSendToken(currentUser, 200, res);
});