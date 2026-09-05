using System.Linq.Expressions;

namespace LibraNextgen.Service.Data;

/// <summary>
/// Small expression composition helpers for building provider-neutral filter
/// predicates without Expression.Invoke (which the Mongo LINQ translator does
/// not support). Used where services compose several optional criteria.
/// </summary>
public static class ExpressionCombine
{
    /// <summary>Combine two predicates over the same parameter with &amp;&amp;.</summary>
    public static Expression<Func<T, bool>> AndAlso<T>(
        Expression<Func<T, bool>> left,
        Expression<Func<T, bool>> right)
    {
        var parameter = left.Parameters[0];
        var rightBody = new ParameterReplacer(parameter).Visit(right.Body);
        return Expression.Lambda<Func<T, bool>>(
            Expression.AndAlso(left.Body, rightBody), parameter);
    }

    /// <summary>Combine two predicates over the same parameter with ||.</summary>
    public static Expression<Func<T, bool>> OrElse<T>(
        Expression<Func<T, bool>> left,
        Expression<Func<T, bool>> right)
    {
        var parameter = left.Parameters[0];
        var rightBody = new ParameterReplacer(parameter).Visit(right.Body);
        return Expression.Lambda<Func<T, bool>>(
            Expression.OrElse(left.Body, rightBody), parameter);
    }

    private sealed class ParameterReplacer(ParameterExpression replacement) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) =>
            node.Type == replacement.Type ? replacement : node;
    }
}
