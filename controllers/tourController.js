const AppError = require('../utils/appError');
const TourModel = require('./../models/tourModels');
const APIFeatures = require('./../utils/apiFeatures');
const catchAsync = require('./../utils/catchAsync');

const factoryHandler = require('./factoryHandlers');

// Configure middleware for alias route
exports.aliasTopFive = (req, res, next) => {
  req.query.limit = '5';
  req.query.sort = '-ratingsAverage,price';
  req.query.fields = 'name,price,difficulty,summary,ratingsAverage';
  next();
};

// Request Handling Function For GET All Tours
exports.getAllTours = catchAsync(async (req, res, next) => {
  // Final Query
  const features = new APIFeatures(TourModel.find().populate('reviews'), req.query)
    .filter()
    .limitFields()
    .sorting()
    .paginate();
  const allTourData = await features.query;

  res.status(200).json({
    status: 'success',
    results: allTourData.length,
    timeOfRequest: req.time,
    data: {
      tours: allTourData
    }
  });
});

// Request Handling Function For GET one Tour
exports.getOneTour = catchAsync(async (req, res, next) => {
  const requestedTour = await TourModel.findById(req.params.id).populate('reviews');

  if (!requestedTour) {
    return next(new AppError('The Tour with this ID does not exist.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      tour: requestedTour
    }
  });
});

// Request Handling Function For PUT (or) PATCH one Tour
exports.patchTour = factoryHandler.updateOne(TourModel);

// Request Handling Function For DELETE one Tour
exports.deleteTour = factoryHandler.deleteOne(TourModel);

// Request Handling Function For POST new Tour
exports.CreateNewTour = factoryHandler.createOne(TourModel);

exports.getTourStats = catchAsync(async (req, res, next) => {
  const stats = await TourModel.aggregate([
    {
      $match: {
        ratingsAverage: { $gte: 4.5 }
      }
    },
    {
      $group: {
        _id: '$difficulty',
        numberOfTours: { $sum: 1 },
        avgRating: { $avg: '$ratingsAverage' },
        avgPrice: { $avg: '$price' },
        minPrice: { $min: '$price' },
        maxPrice: { $max: '$price' }
      }
    }
  ]);

  res.status(200).json({
    message: 'success',
    data: {
      stats
    }
  });
});

exports.getMonthlyPlan = catchAsync(async (req, res, next) => {
  const year = req.params.year * 1;

  const plan = await TourModel.aggregate([
    {
      $unwind: '$startDates'
    },
    {
      $match: {
        startDates: {
          $gte: new Date(`${year}-01-01`),
          $lte: new Date(`${year}-12-31`)
        }
      }
    },
    {
      $group: {
        _id: { $month: '$startDates' },
        numOfTourStarts: { $sum: 1 },
        tours: { $push: '$name' }
      }
    },
    {
      $addFields: { month: '$_id' }
    },
    {
      $project: {
        _id: 0
      }
    },
    {
      $sort: { month: 1 }
    }
  ]);

  res.status(200).json({
    message: 'success',
    data: {
      plan
    }
  });
});
